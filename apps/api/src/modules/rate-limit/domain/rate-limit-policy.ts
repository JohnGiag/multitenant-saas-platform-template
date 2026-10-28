import { createHash } from 'node:crypto';
import type { Principal, TenantTier } from '@repo/shared-types';

export const WINDOW_MS = 60_000;

// Requests per minute for each authenticated caller (one user or one API key), by its tenant's tier.
export const TIER_LIMITS: Record<TenantTier, number> = { free: 120, pro: 600, enterprise: 3000 };

// Requests per minute per client IP and route for unauthenticated routes (e.g. login). Generous enough
// for a whole office behind one NAT address; accounts are protected by the per-account login limit.
export const PUBLIC_LIMIT = 100;

// Password attempts per account and client IP. A stranger's guesses lock only their own address out,
// so they cannot lock the account's owner out.
export const LOGIN_ACCOUNT_LIMIT = 10;
export const LOGIN_ACCOUNT_WINDOW_MS = 15 * 60_000;
// Per account from all IPs together: stops password guessing spread across many addresses, while staying
// far above what one person typing can reach.
export const LOGIN_CEILING_LIMIT = 100;
// Reset requests per email from all IPs together (the per-IP limit above also applies).
export const RESET_CEILING_LIMIT = 30;

// An account's bucket for one client IP.
export const perIp = (key: string, ip: string) => `${key}:ip:${ip}`;

export interface RateLimitPlan {
  key: string;
  limit: number;
  windowMs: number;
  // What to do when Redis is unreachable: let the request through unmetered, or answer 503.
  failOpen: boolean;
}

export function planRateLimit(
  principal: Principal | null,
  client: { ip: string; method: string; route: string },
): RateLimitPlan {
  if (principal) {
    // Known callers keep working during a Redis outage.
    const key = `rl:${principal.tenantId}:${principal.kind}:${principal.id}`;
    return { key, limit: TIER_LIMITS[principal.tier], windowMs: WINDOW_MS, failOpen: true };
  }
  // Express answers HEAD with the GET handler; a separate HEAD bucket would double every GET limit.
  const method = client.method === 'HEAD' ? 'GET' : client.method;
  // Public routes stay closed during an outage, so login cannot be brute-forced unmetered.
  return { key: `rl:ip:${client.ip}:${method}:${client.route}`, limit: PUBLIC_LIMIT, windowMs: WINDOW_MS, failOpen: false };
}

// Emails are hashed so Redis keys never hold PII.
const hashEmail = (email: string) => createHash('sha256').update(email).digest('hex');

// Sign-in with a tenantId (the second step after a TenantChoice, or a client that knows its tenant): per account.
export function loginAccountKey(tenantId: string, email: string): string {
  return `rl:login:${tenantId}:${hashEmail(email)}`;
}

// Sign-in by email alone tries every account with that email, so it is limited per email, whatever the tenant.
// Counted before the lookup: a 429 tells nothing about whether the email has accounts.
export function loginEmailKey(email: string): string {
  return `rl:login-email:${hashEmail(email)}`;
}

// Reset requests per email (one request mails every account with it), so nobody can flood an inbox.
export function passwordResetKey(email: string): string {
  return `rl:reset:${hashEmail(email)}`;
}

// Guesses at the current password when changing it count like login attempts, per account.
export function passwordChangeKey(tenantId: string, userId: string): string {
  return `rl:password:${tenantId}:${userId}`;
}
