import type { ConfigService } from '@nestjs/config';

// WEBHOOKS_ALLOW_PRIVATE=true lets endpoints use http and private addresses (localhost, the LAN), to test against a
// receiver on your own machine. Never in production, where it would reopen the door to internal services (SSRF).
export function allowPrivateTargets(config: Pick<ConfigService, 'get'>): boolean {
  const allow = config.get<string>('WEBHOOKS_ALLOW_PRIVATE') === 'true';
  if (allow && process.env.NODE_ENV === 'production') {
    throw new Error('WEBHOOKS_ALLOW_PRIVATE=true is refused in production');
  }
  return allow;
}
