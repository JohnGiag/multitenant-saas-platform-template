import { Injectable, type OnModuleInit } from '@nestjs/common';
import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  NotificationChannelRegistry,
  PermanentDeliveryError,
  type Delivery,
  type NotificationChannel,
} from '../../modules/notifications/domain/notification-channel.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

const ServiceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});
type ServiceAccount = z.infer<typeof ServiceAccountSchema>;

// Tenant config (PUT /v1/integrations/fcm): { serviceAccount: "<the Firebase service account JSON>" }.
@Injectable()
export class FcmChannel implements NotificationChannel, OnModuleInit {
  readonly key = 'push';
  readonly integration = 'fcm';

  constructor(
    private readonly registry: NotificationChannelRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async deliver({ tenantId, notification, secrets }: Delivery): Promise<void> {
    const account = parseServiceAccount(secrets.serviceAccount);
    const devices = await this.prisma.pushDevice.findMany({
      where: { tenantId, userId: notification.userId },
      select: { token: true },
    });
    if (devices.length === 0) return;

    // shortcut: a new OAuth token per job (one extra request); cache it per tenant for ~1 h if push volume grows.
    const accessToken = await this.accessToken(account);
    // shortcut: a retry after a partial failure re-sends to devices that already got it (FCM has no
    // idempotency key); split into one job per device if duplicates matter.
    for (const { token } of devices) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: notification.title, body: notification.body },
            data: notification.data,
          },
        }),
      });
      if (res.ok) continue;
      const body = await res.text();
      // Only a dead token is the device's fault: UNREGISTERED (404), or a 400 about the token itself.
      // Other 400s (message too big, invalid data key) are the message's fault: never drop devices for them.
      if (res.status === 404 || (res.status === 400 && isTokenError(body))) {
        await this.prisma.pushDevice.deleteMany({ where: { tenantId, token } });
        continue;
      }
      throwForStatus('FCM', res.status, body);
    }
  }

  // OAuth 2.0 service-account flow: a JWT signed with the account's key, exchanged for an access token.
  private async accessToken(account: ServiceAccount): Promise<string> {
    let assertion: string;
    try {
      assertion = await new SignJWT({ scope: SCOPE })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuer(account.client_email)
        .setAudience(TOKEN_URL)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(await importPKCS8(account.private_key, 'RS256'));
    } catch {
      throw new PermanentDeliveryError('FCM service account has an unusable private_key');
    }
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throwForStatus('Google OAuth', res.status, await res.text());
    return ((await res.json()) as { access_token: string }).access_token;
  }
}

// FCM names the field (`message.token`) or says "registration token" when the token is the problem.
function isTokenError(body: string): boolean {
  return body.includes('message.token') || /registration token/i.test(body);
}

function parseServiceAccount(raw: string | undefined): ServiceAccount {
  try {
    return ServiceAccountSchema.parse(JSON.parse(raw ?? ''));
  } catch {
    throw new PermanentDeliveryError('FCM integration needs "serviceAccount": the service account JSON');
  }
}

// Rate limited or down: retry with backoff. Anything else (revoked key, wrong project): won't heal.
function throwForStatus(service: string, status: number, body: string): never {
  const detail = `${service} answered ${status}: ${body.slice(0, 300)}`;
  if (status === 429 || status >= 500) throw new Error(detail);
  throw new PermanentDeliveryError(detail);
}
