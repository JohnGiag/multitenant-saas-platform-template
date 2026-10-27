import type { Principal } from '@repo/shared-types';

// Which tenant a request acts on: always the caller's own, unless a SuperAdmin targets another
// one explicitly (X-Tenant-Id). Returns null when a non-SuperAdmin asks for a foreign tenant.
export function resolveTenantId(principal: Principal, requestedTenantId: string | undefined): string | null {
  if (requestedTenantId === undefined || requestedTenantId === principal.tenantId) return principal.tenantId;
  return principal.role === 'SuperAdmin' ? requestedTenantId : null;
}
