import 'server-only';
import {
  CLIENT_IP_HEADER,
  DASHBOARD_SECRET_HEADER,
  type Capability,
  type CapabilityResponse,
  type Principal,
  type Tenant,
} from '@repo/shared-types';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { clientIpFrom, parseProxyHops } from './client-ip';
import type { FormState } from './form-state';
import { getTenantOverride, getToken } from './session';

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';
export const TIMEOUT_MS = 10_000;
// Read once, so a bad value fails at startup rather than on the first sign-in.
const PROXY_HOPS = parseProxyHops(process.env.TRUST_PROXY_HOPS);
const PROXY_SECRET = process.env.DASHBOARD_PROXY_SECRET || undefined;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  // Leave out the SuperAdmin's selected tenant: the layout's calls must work even if it was deleted (404).
  ownTenant?: boolean;
}

// Public routes (login, invitation, password reset) are rate limited per client IP. Every call carries the
// browser's IP (see forwardedClient); without it, all browsers would share this server's bucket.
export async function publicApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, options, {});
}

// As the signed-in user (and the SuperAdmin's selected tenant). No session or an expired one: back to /login.
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await getToken();
  if (!token) redirect('/login');
  const tenant = options.ownTenant ? undefined : await getTenantOverride();
  try {
    return await request<T>(path, options, { authorization: `Bearer ${token}`, ...(tenant && { 'x-tenant-id': tenant }) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    throw error;
  }
}

// The browser's IP, vouched for by the shared secret: the API believes it only with the secret. Sent on every
// call, so a caller whose session just expired is limited per browser too, not per dashboard.
async function forwardedClient(): Promise<Record<string, string>> {
  if (!PROXY_SECRET) return {};
  const ip = clientIpFrom((await headers()).get('x-forwarded-for'), PROXY_HOPS);
  return ip ? { [CLIENT_IP_HEADER]: ip, [DASHBOARD_SECRET_HEADER]: PROXY_SECRET } : {};
}

async function request<T>(path: string, { method = 'GET', body }: RequestOptions, auth: Record<string, string>): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, {
    method,
    headers: { ...(await forwardedClient()), ...auth, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  // Not JSON, e.g. a load balancer's HTML 502 page during a deploy: errorMessage falls back to the status.
  const data: unknown = text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, errorMessage(res, data));
  return data as T;
}

// Nest answers { message: string | { path, message }[] }; validation issues come as the array.
function errorMessage(res: Response, data: unknown): string {
  if (res.status === 429) return `Too many attempts. Try again in ${res.headers.get('retry-after') ?? 'a few'} seconds.`;
  const message = (data as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map((m: { message?: string }) => m.message).join(' ');
  return `Request failed (${res.status})`;
}

// For server actions: an API rejection becomes the form's message; anything else is a real failure.
export function apiFailure(error: unknown): FormState {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}

// Deduplicated per request, so the layout and the page can both ask.
export const getPrincipal = cache(() => api<Principal>('/auth/me', { ownTenant: true }));
export const getCurrentTenant = cache(() => api<Tenant>('/tenants/current'));
export const getCapabilities = cache(async (): Promise<Capability[]> => (await api<CapabilityResponse>('/system/capabilities')).capabilities);
