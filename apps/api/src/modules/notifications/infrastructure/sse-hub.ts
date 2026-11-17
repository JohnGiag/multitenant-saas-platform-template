import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { interval, Observable } from 'rxjs';
import { REDIS_CLIENT } from '../../../infrastructure/redis/redis.module.js';

const CHANNEL = 'notifications:sse';
// Below common proxy idle timeouts (often 60 s), so open streams are not cut.
const HEARTBEAT_MS = 25_000;
// Enough for several tabs, devices and a reconnect overlap. Per instance: the count lives in memory.
export const MAX_STREAMS_PER_USER = 5;
// The sign-in is checked when a stream opens, so a stream is closed after a local access token's lifetime: the
// browser reconnects on its own, and has to sign in again if the session is gone (or the user removed).
export const MAX_STREAM_MS = 15 * 60_000;

// What a stream carries: what a module published, and the hub's own `ping` and `closed` (the last event of a stream
// the server ends, e.g. over the cap: do not reconnect).
export interface SseEvent {
  type: string;
  data: string | object;
}

interface SseMessage extends SseEvent {
  tenantId: string;
  recipientId: string;
}

interface OpenStream {
  deliver(event: SseEvent): void;
  end(): void;
  // Closed to make room for a newer stream of the same recipient.
  replace(): void;
}

// Real-time fan-out across API instances: publish() sends to one Redis Pub/Sub channel, every instance receives it
// and pushes it to the recipient's streams open on that instance. Notifications use it for users; a module with
// real-time events of its own publishes them here and serves stream() from its own @Sse route.
// shortcut: one channel for all tenants, so every instance parses every event; shard by tenant if
// event volume per instance becomes a bottleneck.
@Injectable()
export class SseHub implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SseHub');
  // Per recipient ("tenantId:recipientId"): their open streams on this instance, oldest first. An event costs one
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
      const { tenantId, recipientId, type, data } = message;
      for (const stream of this.streams.get(`${tenantId}:${recipientId}`) ?? []) stream.deliver({ type, data });
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

  // `recipientId`: a user's id, or a module's own kind of recipient under a prefix no user id can equal
  // ("player:<id>"). `type` names the SSE event; `ping` and `closed` are the hub's own.
  async publish(tenantId: string, recipientId: string, type: string, data: string | object): Promise<void> {
    const message: SseMessage = { tenantId, recipientId, type, data };
    await this.redis.publish(CHANNEL, JSON.stringify(message));
  }

  stream(tenantId: string, recipientId: string): Observable<SseEvent> {
    return new Observable<SseEvent>((subscriber) => {
      const key = `${tenantId}:${recipientId}`;
      const open = this.streams.get(key) ?? [];
      this.streams.set(key, open);
      const stream: OpenStream = {
        deliver: (event) => subscriber.next(event),
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
      const lifetime = setTimeout(() => subscriber.complete(), MAX_STREAM_MS);
      return () => {
        heartbeat.unsubscribe();
        clearTimeout(lifetime);
        open.splice(open.indexOf(stream), 1);
        if (open.length === 0) this.streams.delete(key);
      };
    });
  }
}
