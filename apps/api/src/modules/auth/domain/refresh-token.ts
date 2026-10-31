import { createHmac, timingSafeEqual } from 'node:crypto';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
// Sliding: each refresh extends it, so only a session left idle this long ends by itself.
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
// A browser sends parallel requests, and each may refresh with the same token.
const REUSE_LEEWAY_MS = 30_000;

export interface RefreshTokenClaims {
  tenantId: string;
  sessionId: string;
  generation: number;
}

// "ert_<tenantId>.<sessionId>.<generation>.<HMAC-SHA256>". Derived from the session, never stored: a database leak
// exposes no token, and parallel refreshes of one token all get the same next token, so no browser is left holding
// a dead one. It carries its tenant, which is how refreshing stays tenant-scoped before anyone is authenticated.
const TOKEN_PATTERN = /^ert_([0-9a-f-]{36})\.([0-9a-f-]{36})\.(\d{1,10})\.([A-Za-z0-9_-]{43})$/;

const mac = (key: Uint8Array, payload: string) => createHmac('sha256', key).update(`refresh:${payload}`).digest();
const payloadOf = ({ tenantId, sessionId, generation }: RefreshTokenClaims) => `${tenantId}.${sessionId}.${generation}`;

export function signRefreshToken(key: Uint8Array, claims: RefreshTokenClaims): string {
  const payload = payloadOf(claims);
  return `ert_${payload}.${mac(key, payload).toString('base64url')}`;
}

export function parseRefreshToken(key: Uint8Array, raw: string): RefreshTokenClaims | null {
  const match = TOKEN_PATTERN.exec(raw);
  if (!match) return null;
  const claims = { tenantId: match[1]!, sessionId: match[2]!, generation: Number(match[3]) };
  const given = Buffer.from(match[4]!, 'base64url');
  const expected = mac(key, payloadOf(claims));
  return given.length === expected.length && timingSafeEqual(given, expected) ? claims : null;
}

export type RefreshDecision = 'rotate' | 'repeat' | 'reuse';

// The current token rotates. The one before it is answered again for a moment (a parallel request). Anything older
// was replayed: either the owner or a thief holds a stale copy, so the session ends.
export function decideRefresh(
  session: { generation: number; rotatedAt: Date | null },
  tokenGeneration: number,
  now: Date,
): RefreshDecision {
  if (tokenGeneration === session.generation) return 'rotate';
  const justRotated = session.rotatedAt !== null && now.getTime() - session.rotatedAt.getTime() <= REUSE_LEEWAY_MS;
  return tokenGeneration === session.generation - 1 && justRotated ? 'repeat' : 'reuse';
}
