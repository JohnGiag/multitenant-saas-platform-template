import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Notification } from '@repo/shared-types';
import type { Redis } from 'ioredis';
import { interval, Observable } from 'rxjs';
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

interface OpenStream {
  deliver(notification: Notification): void;
  end(): void;
  // Closed to make room for a newer stream of the same user.
  replace(): void;
}

// Real-time fan-out across API instances: send() publishes to one Redis Pub/Sub channel, every
// instance receives it and pushes it to the matching users connected to that instance.
// shortcut: one channel for all tenants, so every instance parses every event; shard by tenant if
// event volume per instance becomes a bottleneck.
@Injectable()
export class SseHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SseHub');
  // Per user ("tenantId:userId"): their open streams on this instance, oldest first. An event costs one
  // lookup, not one check per open stream.
  private readonly streams = new Map<string, OpenStream[]>();
  private subscriber?: Redis;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleInit(): void {
    // A subscribing connection can run no other commands, and must wait out outages rather than
    // fail fast like the request-path client; ioredis re-subscribes after every reconnect.
    this.subscriber = this.redis.duplicate({ maxRetriesPerRequest: null, commandTimeout: undefined });
    this.subscriber.on('message', (_channel, raw: string) => {
      let message: SseMessage;
      try {
        message = JSON.parse(raw) as SseMessage;
      } catch {
        this.logger.warn('Ignored a malformed SSE message');
        return;
      }
      for (const stream of this.streams.get(`${message.tenantId}:${message.userId}`) ?? []) {
        stream.deliver(message.notification);
      }
    });
    this.subscriber.subscribe(CHANNEL).catch((err: unknown) =>
      this.logger.error(`SSE subscribe failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  onModuleDestroy(): void {
    // Copies: ending a stream removes it from these lists.
    for (const open of [...this.streams.values()]) for (const stream of [...open]) stream.end();
    // Not quit(): with retries unlimited it would wait forever during an outage, and a subscriber has
    // nothing pending to flush.
    this.subscriber?.disconnect();
  }

  async publish(tenantId: string, notification: Notification): Promise<void> {
    const message: SseMessage = { tenantId, userId: notification.userId, notification };
    await this.redis.publish(CHANNEL, JSON.stringify(message));
  }

  stream(tenantId: string, userId: string): Observable<NotificationEvent> {
    return new Observable<NotificationEvent>((subscriber) => {
      const key = `${tenantId}:${userId}`;
      const open = this.streams.get(key) ?? [];
      this.streams.set(key, open);
      const stream: OpenStream = {
        deliver: (data) => subscriber.next({ type: 'notification', data }),
        end: () => subscriber.complete(),
        // A final "closed" event tells the client not to reconnect; otherwise tabs over the cap
        // would keep closing each other in turn.
        replace: () => {
          subscriber.next({ type: 'closed', data: 'Too many open streams: replaced by a newer one' });
          subscriber.complete();
        },
      };
      open.push(stream);
      // Over the cap, close the oldest rather than refuse the newest: the tab in use wins.
      if (open.length > MAX_STREAMS_PER_USER) open[0]!.replace();

      const heartbeat = interval(HEARTBEAT_MS).subscribe(() => subscriber.next({ type: 'ping', data: '' }));
      return () => {
        heartbeat.unsubscribe();
        open.splice(open.indexOf(stream), 1);
        if (open.length === 0) this.streams.delete(key);
      };
    });
  }
}
