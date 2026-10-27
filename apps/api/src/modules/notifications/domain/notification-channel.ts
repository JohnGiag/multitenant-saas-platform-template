import type { Notification } from '@repo/shared-types';

export interface Delivery {
  tenantId: string;
  notification: Notification;
  // The tenant's decrypted integration config, loaded by the worker just before delivery.
  secrets: Record<string, string>;
  // Stable across retries of the same job: use it as an idempotency key where the provider has one.
  deliveryId: string;
}

// A durable delivery channel (email, push, ...). Optional modules implement it and register it in
// NotificationChannelRegistry; a channel whose module is not installed simply never registers.
export interface NotificationChannel {
  readonly key: string;
  // The tenant_integrations provider holding its credentials.
  readonly integration: string;
  // Throw PermanentDeliveryError when retrying cannot help; any other error is retried with backoff.
  deliver(delivery: Delivery): Promise<void>;
}

// E.g. rejected credentials or an invalid sender: goes straight to the dead-letter queue.
export class PermanentDeliveryError extends Error {
  override name = 'PermanentDeliveryError';
}

export class NotificationChannelRegistry {
  private readonly channels = new Map<string, NotificationChannel>();

  register(channel: NotificationChannel): void {
    if (this.channels.has(channel.key)) throw new Error(`Notification channel "${channel.key}" registered twice`);
    this.channels.set(channel.key, channel);
  }

  get(key: string): NotificationChannel | undefined {
    return this.channels.get(key);
  }

  all(): NotificationChannel[] {
    return [...this.channels.values()];
  }
}

// One job per channel and notification, so a retry of one channel never repeats another.
export interface NotificationJob {
  tenantId: string;
  channel: string;
  notification: Notification;
}

export type NotificationJobResult = { status: 'delivered' } | { status: 'skipped'; reason: string };
