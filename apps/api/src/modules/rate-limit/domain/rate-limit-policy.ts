import { createHash } from 'node:crypto';
import type { Principal, TenantTier } from '@repo/shared-types';

export const WINDOW_MS = 60_000;

// Requests per minute for each authenticated caller (one user or one API key), by its tenant's tier.
export const TIER_LIMITS: Record<TenantTier, number> = { free: 120, pro: 600, enterprise: 3000 };

// Requests per minute per client IP and route for unauthenticated routes (e.g. login). Generous enough
// for a whole office behind one NAT address; accounts are protected by the per-account login limit.
export const PUBLIC_LIMIT = 100;

// Login attempts per account, from any IP: stops password guessing spread across many addresses.
export const LOGIN_ACCOUNT_LIMIT = 10;
export const LOGIN_ACCOUNT_WINDOW_MS = 15 * 60_000;

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

// The email is hashed so Redis keys never hold PII.
export function loginAccountKey(tenantId: string, email: string): string {
  return `rl:login:${tenantId}:${createHash('sha256').update(email).digest('hex')}`;
}
