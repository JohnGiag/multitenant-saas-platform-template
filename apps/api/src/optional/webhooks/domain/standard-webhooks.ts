import { createHmac, randomBytes } from 'node:crypto';

// Standard Webhooks (standardwebhooks.com), the scheme Svix and Clerk use too, so receivers can verify with an
// existing library in any language. The secret is "whsec_" + base64 key; each delivery carries webhook-id,
// webhook-timestamp (unix seconds) and webhook-signature ("v1," + base64 HMAC-SHA256 of "<id>.<timestamp>.<body>").
export function newWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64')}`;
}

export function signWebhook({ secret, id, timestamp, body }: { secret: string; id: string; timestamp: number; body: string }): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}
