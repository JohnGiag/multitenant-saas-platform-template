import { createHmac, timingSafeEqual } from 'node:crypto';

// Svix (Standard Webhooks) signatures, as Clerk sends them: HMAC-SHA256 over
// "<svix-id>.<svix-timestamp>.<raw body>", keyed with the base64 part of the "whsec_…" secret.
// The svix-signature header lists one or more "v1,<base64>" entries (several during secret rotation).
const TOLERANCE_SECONDS = 5 * 60;

export interface SignedWebhook {
  secret: string;
  id: string;
  timestamp: string;
  signatures: string;
  body: Uint8Array | string;
  nowSeconds?: number;
}

export function verifyWebhookSignature({ secret, id, timestamp, signatures, body, nowSeconds }: SignedWebhook): boolean {
  const sentAt = Number(timestamp);
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  // Old or future-dated deliveries are refused, so a captured request cannot be replayed later.
  if (!id || !Number.isInteger(sentAt) || Math.abs(now - sentAt) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(body).digest();
  return signatures.split(' ').some((entry) => {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) return false;
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
