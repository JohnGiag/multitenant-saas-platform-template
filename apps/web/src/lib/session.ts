import 'server-only';
import type { AuthToken } from '@repo/shared-types';
import { cookies } from 'next/headers';

// httpOnly: page scripts (and so any XSS) can never read the token. Server actions check Origin (CSRF).
const TOKEN_COOKIE = 'session';
// The tenant a SuperAdmin is acting on (sent as X-Tenant-Id); absent means their own.
const TENANT_COOKIE = 'tenant';

const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' } as const;

// The one place that knows where the bearer token comes from: swap this to support another auth provider.
export async function getToken(): Promise<string | undefined> {
  return (await cookies()).get(TOKEN_COOKIE)?.value;
}

export async function startSession({ accessToken, expiresIn }: AuthToken): Promise<void> {
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, accessToken, { ...options, maxAge: expiresIn });
  jar.delete(TENANT_COOKIE);
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(TOKEN_COOKIE);
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
