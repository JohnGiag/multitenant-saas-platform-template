import type { Principal, Role } from '@repo/shared-types';

export type AccessDecision = 'allow' | 'unauthenticated' | 'forbidden';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Deny by default: a route with no roles listed admits nobody, and SuperAdmin is never implied.
// Auditors are read-only, except on self-service routes about their own account (e.g. their password).
export function decideAccess(
  principal: Principal | null,
  allowedRoles: readonly Role[] | undefined,
  method: string,
  selfService = false,
): AccessDecision {
  if (!principal) return 'unauthenticated';
  if (!allowedRoles?.includes(principal.role)) return 'forbidden';
  if (principal.role === 'Auditor' && !selfService && !READ_METHODS.has(method.toUpperCase())) return 'forbidden';
  return 'allow';
}
