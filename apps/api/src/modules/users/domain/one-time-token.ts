import { createHash, randomBytes } from 'node:crypto';

// Tokens for emailed links (invitations, password resets): 256 random bits, single use, stored only
// as a SHA-256 hash. The token is random, so a slow hash would add nothing (same as API keys).
export function newOneTimeToken(): { token: string; hash: Uint8Array<ArrayBuffer> } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashOneTimeToken(token) };
}

export function hashOneTimeToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token).digest());
}

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
