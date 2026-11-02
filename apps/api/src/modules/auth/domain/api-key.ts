import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiKeyMode } from '@repo/shared-types';

// Format: sk_<live|test>_<12 hex prefix>_<43 char base64url secret>. The mode is in the key, so one pasted in the wrong
// place is obvious. Only the prefix is stored in clear.
const KEY_PATTERN = /^sk_(live|test)_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export function generateApiKey(mode: ApiKeyMode = 'live') {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { prefix, secret, raw: `sk_${mode}_${prefix}_${secret}` };
}

export function parseApiKey(raw: string): { mode: ApiKeyMode; prefix: string; secret: string } | null {
  const match = KEY_PATTERN.exec(raw);
  return match ? { mode: match[1] as ApiKeyMode, prefix: match[2]!, secret: match[3]! } : null;
}

export function hashApiKeySecret(secret: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(secret).digest());
}

export function apiKeySecretMatches(secret: string, storedHash: Uint8Array): boolean {
  const actual = hashApiKeySecret(secret);
  return actual.length === storedHash.length && timingSafeEqual(actual, storedHash);
}
