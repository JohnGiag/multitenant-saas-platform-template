import { createHmac, timingSafeEqual } from 'node:crypto';

// Stripe's webhook signatures: the Stripe-Signature header is "t=<unix seconds>,v1=<hex>[,v1=<hex>…]", the HMAC-SHA256
// of "<t>.<raw body>" keyed with the endpoint's whole "whsec_…" secret. Several v1 entries appear while a secret is rolled.
const TOLERANCE_SECONDS = 5 * 60;

export interface SignedStripeEvent {
  secret: string;
  header: string;
  body: Uint8Array | string;
  nowSeconds?: number;
}

export function verifyStripeSignature({ secret, header, body, nowSeconds }: SignedStripeEvent): boolean {
  const entries = header.split(',').map((entry) => entry.split('=', 2) as [string, string | undefined]);
  const timestamp = entries.find(([name]) => name === 't')?.[1] ?? '';
  const sentAt = Number(timestamp);
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  // Old or future-dated deliveries are refused, so a captured request cannot be replayed later.
  if (!Number.isInteger(sentAt) || Math.abs(now - sentAt) > TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
  return entries.some(([name, value]) => {
    if (name !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
