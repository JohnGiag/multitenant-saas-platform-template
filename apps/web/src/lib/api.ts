import 'server-only';
import type { Capability, CapabilityResponse, Principal, Tenant } from '@repo/shared-types';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { FormState } from './form-state';
import { getTenantOverride, getToken } from './session';

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';
export const TIMEOUT_MS = 10_000;

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

// shortcut: public routes (login, invitation, password reset) all reach the API from this server's IP, so they
// share one per-IP rate-limit bucket; forward the client IP through a trusted proxy hop when that is too low.
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

async function request<T>(path: string, { method = 'GET', body }: RequestOptions, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined && { 'content-type': 'application/json' }) },
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
