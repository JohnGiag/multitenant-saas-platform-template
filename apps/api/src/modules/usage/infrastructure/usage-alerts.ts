import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { TenantEvents, type TenantEvent } from '../../events/domain/tenant-events.js';
import { MailNotConfiguredError, SYSTEM_MAILER, type SystemMailer } from '../../mail/domain/ports/system-mailer.js';

// Mails a tenant's admins when a meter reaches 80% or 100% of its quota. An event listener, so the sending gets the
// event queue's retries and dead-letter queue. A retry can mail an admin twice, which beats not at all.
@Injectable()
export class UsageAlerts implements OnModuleInit {
  private readonly logger = new Logger('UsageAlerts');

  constructor(
    private readonly events: TenantEvents,
    private readonly prisma: PrismaService,
    @Inject(SYSTEM_MAILER) private readonly mailer: SystemMailer,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(async (event) => {
      if (event.type === 'usage.threshold_reached') await this.mail(event);
    });
  }

  private async mail({ tenantId, data }: TenantEvent): Promise<void> {
    const { meter, percent, limit } = data as { meter: string; percent: number; limit: number };
    const admins = await this.prisma.user.findMany({ where: { tenantId, role: 'TenantAdmin' }, select: { email: true } });
    const subject = `You have used ${percent}% of your ${meter} quota`;
    const text = `Your tenant has used ${percent}% of its monthly quota of ${limit} for ${meter}. Open the Usage page of your dashboard for details.`;
    try {
      for (const { email } of admins) await this.mailer.send({ to: email, subject, text });
    } catch (error) {
      // Retrying cannot help a deployment with no mail account.
      if (error instanceof MailNotConfiguredError) this.logger.warn(`Usage alert not sent for tenant ${tenantId}: no mail account`);
      else throw error;
    }
  }
}
