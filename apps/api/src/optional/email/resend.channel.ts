import { Injectable, type OnModuleInit } from '@nestjs/common';
import { isRetryableStatus, sendWithResend } from '../../infrastructure/email/resend.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  NotificationChannelRegistry,
  PermanentDeliveryError,
  type Delivery,
  type NotificationChannel,
} from '../../modules/notifications/domain/notification-channel.js';

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

    const result = await sendWithResend({
      apiKey,
      from,
      to: user.email,
      subject: notification.title,
      text: notification.body,
      idempotencyKey: deliveryId,
    });
    if (result.ok) return;
    if (isRetryableStatus(result.status)) throw new Error(result.detail);
    throw new PermanentDeliveryError(result.detail);
  }
}
