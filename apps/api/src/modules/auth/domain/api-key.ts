import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Format: eak_<12 hex prefix>_<43 char base64url secret>. Only the prefix is stored in clear.
const KEY_PATTERN = /^eak_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export function generateApiKey() {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { prefix, secret, raw: `eak_${prefix}_${secret}` };
}

export function parseApiKey(raw: string): { prefix: string; secret: string } | null {
  const match = KEY_PATTERN.exec(raw);
  return match ? { prefix: match[1]!, secret: match[2]! } : null;
}

export function hashApiKeySecret(secret: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(secret).digest());
}

export function apiKeySecretMatches(secret: string, storedHash: Uint8Array): boolean {
  const actual = hashApiKeySecret(secret);
  return actual.length === storedHash.length && timingSafeEqual(actual, storedHash);
}
