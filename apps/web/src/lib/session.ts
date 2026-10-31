import 'server-only';
import { auth } from '@clerk/nextjs/server';
import type { AuthToken } from '@repo/shared-types';
import { cookies } from 'next/headers';
import { CLERK } from './auth-mode';

// httpOnly: page scripts (and so any XSS) can never read the token. Server actions check Origin (CSRF).
const TOKEN_COOKIE = 'session';
// Local mode: renews the session once the access token is gone or refused (app/session/refresh).
const REFRESH_COOKIE = 'refresh';
// The tenant a SuperAdmin is acting on (sent as X-Tenant-Id); absent means their own.
const TENANT_COOKIE = 'tenant';

const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' } as const;

// The one place that knows where the bearer token comes from. Clerk mode: Clerk's session token, read on this
// server from Clerk's own cookie (kept fresh by proxy.ts); local mode: ours.
export async function getToken(): Promise<string | undefined> {
  if (CLERK) return (await (await auth()).getToken()) ?? undefined;
  return (await cookies()).get(TOKEN_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}

export async function startSession(token: AuthToken): Promise<void> {
  await renewSession(token);
  (await cookies()).delete(TENANT_COOKIE);
}

// Keeps the tenant a SuperAdmin has open: unlike a sign-in, the same person carries on.
export async function renewSession({ accessToken, expiresIn, refreshToken, refreshExpiresIn }: AuthToken): Promise<void> {
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, accessToken, { ...options, maxAge: expiresIn });
  jar.set(REFRESH_COOKIE, refreshToken, { ...options, maxAge: refreshExpiresIn });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(TOKEN_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(TENANT_COOKIE);
}

export async function getTenantOverride(): Promise<string | undefined> {
  return (await cookies()).get(TENANT_COOKIE)?.value;
}

export async function setTenantOverride(tenantId: string | null): Promise<void> {
  const jar = await cookies();
  if (tenantId) jar.set(TENANT_COOKIE, tenantId, options);
  else jar.delete(TENANT_COOKIE);
}
