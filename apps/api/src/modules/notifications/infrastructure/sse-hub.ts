import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Notification } from '@repo/shared-types';
import type { Redis } from 'ioredis';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';
import type { NotificationEvent } from '../domain/ports/notification.service.js';

const CHANNEL = 'notifications:sse';
// Below common proxy idle timeouts (often 60 s), so open streams are not cut.
const HEARTBEAT_MS = 25_000;
// Enough for several tabs, devices and a reconnect overlap. Per instance: the count lives in memory.
export const MAX_STREAMS_PER_USER = 5;

interface SseMessage {
  tenantId: string;
  userId: string;
  notification: Notification;
}

// Real-time fan-out across API instances: send() publishes to one Redis Pub/Sub channel, every
// instance receives it and pushes it to the matching users connected to that instance.
// shortcut: one channel for all tenants, so every instance parses every event; shard by tenant if
// event volume per instance becomes a bottleneck.
@Injectable()
export class SseHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SseHub');
  private readonly events = new Subject<SseMessage>();
  // Per user: a close function for each open stream, oldest first.
  private readonly openStreams = new Map<string, Array<() => void>>();
  private subscriber?: Redis;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleInit(): void {
    // A subscribing connection can run no other commands, and must wait out outages rather than
    // fail fast like the request-path client; ioredis re-subscribes after every reconnect.
    this.subscriber = this.redis.duplicate({ maxRetriesPerRequest: null, commandTimeout: undefined });
    this.subscriber.on('message', (_channel, raw: string) => {
      try {
        this.events.next(JSON.parse(raw) as SseMessage);
      } catch {
        this.logger.warn('Ignored a malformed SSE message');
      }
    });
    this.subscriber.subscribe(CHANNEL).catch((err: unknown) =>
      this.logger.error(`SSE subscribe failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  onModuleDestroy(): void {
    this.events.complete();
    // Not quit(): with retries unlimited it would wait forever during an outage, and a subscriber has
    // nothing pending to flush.
    this.subscriber?.disconnect();
  }

  async publish(tenantId: string, notification: Notification): Promise<void> {
    const message: SseMessage = { tenantId, userId: notification.userId, notification };
    await this.redis.publish(CHANNEL, JSON.stringify(message));
  }

  stream(tenantId: string, userId: string): Observable<NotificationEvent> {
    const mine = this.events.pipe(
      filter((e) => e.tenantId === tenantId && e.userId === userId),
      map((e): NotificationEvent => ({ type: 'notification', data: e.notification })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(map((): NotificationEvent => ({ type: 'ping', data: '' })));

    return new Observable<NotificationEvent>((subscriber) => {
      const key = `${tenantId}:${userId}`;
      const open = this.openStreams.get(key) ?? [];
      this.openStreams.set(key, open);
      // A final "closed" event tells the client not to reconnect; otherwise tabs over the cap
      // would keep closing each other in turn.
      const close = () => {
        subscriber.next({ type: 'closed', data: 'Too many open streams: replaced by a newer one' });
        subscriber.complete();
      };
      open.push(close);
      // Over the cap, close the oldest rather than refuse the newest: the tab in use wins.
      if (open.length > MAX_STREAMS_PER_USER) open[0]!();

      const subscription = merge(mine, heartbeat).subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        open.splice(open.indexOf(close), 1);
        if (open.length === 0) this.openStreams.delete(key);
      };
    });
  }
}
