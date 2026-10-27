import type { Principal, Role } from '@repo/shared-types';

export type AccessDecision = 'allow' | 'unauthenticated' | 'forbidden';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Deny by default: a route with no roles listed admits nobody, and SuperAdmin is never implied.
export function decideAccess(
  principal: Principal | null,
  allowedRoles: readonly Role[] | undefined,
  method: string,
): AccessDecision {
  if (!principal) return 'unauthenticated';
  if (!allowedRoles?.includes(principal.role)) return 'forbidden';
  if (principal.role === 'Auditor' && !READ_METHODS.has(method.toUpperCase())) return 'forbidden';
  return 'allow';
}
