import type { Principal } from '@repo/shared-types';

// Which tenant a request acts on: always the caller's own, unless a SuperAdmin targets another
// one explicitly (X-Tenant-Id). Returns null when a non-SuperAdmin asks for a foreign tenant.
export function resolveTenantId(principal: Principal, requestedTenantId: string | undefined): string | null {
  if (requestedTenantId === undefined || requestedTenantId === principal.tenantId) return principal.tenantId;
  return principal.role === 'SuperAdmin' ? requestedTenantId : null;
}

// Test mode (X-Sandbox) is for a tenant's own members, with the role they have. A SuperAdmin manages tenants, nothing
// inside them, and an API key carries its mode in the key: honouring the header for one would let a live key act on
// test data, or a test key be mistaken for live.
export const maySwitchToSandbox = (principal: Principal) => principal.kind === 'user' && principal.role !== 'SuperAdmin';
