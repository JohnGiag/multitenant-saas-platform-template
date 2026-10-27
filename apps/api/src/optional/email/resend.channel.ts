import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  NotificationChannelRegistry,
  PermanentDeliveryError,
  type Delivery,
  type NotificationChannel,
} from '../../modules/notifications/domain/notification-channel.js';

const RESEND_URL = 'https://api.resend.com/emails';

// Tenant config (PUT /v1/integrations/resend): { apiKey, from }, e.g. from = "Acme <no-reply@acme.com>".
@Injectable()
export class ResendChannel implements NotificationChannel, OnModuleInit {
  readonly key = 'email';
  readonly integration = 'resend';

  constructor(
    private readonly registry: NotificationChannelRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async deliver({ tenantId, notification, secrets, deliveryId }: Delivery): Promise<void> {
    const { apiKey, from } = secrets;
    if (!apiKey || !from) throw new PermanentDeliveryError('Resend integration needs "apiKey" and "from"');
    const user = await this.prisma.user.findFirst({
      where: { id: notification.userId, tenantId },
      select: { email: true },
    });
    // Deleted since it was queued: nobody left to email.
    if (!user) return;

    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        // Resend drops a repeat with the same key, so a retry after a timeout sends no second email.
        'idempotency-key': deliveryId,
      },
      body: JSON.stringify({ from, to: [user.email], subject: notification.title, text: notification.body }),
    });
    if (res.ok) return;
    const detail = `Resend answered ${res.status}: ${(await res.text()).slice(0, 300)}`;
    // Rate limited or down: retry with backoff. Anything else (bad key, unverified sender): won't heal.
    if (res.status === 429 || res.status >= 500) throw new Error(detail);
    throw new PermanentDeliveryError(detail);
  }
}
