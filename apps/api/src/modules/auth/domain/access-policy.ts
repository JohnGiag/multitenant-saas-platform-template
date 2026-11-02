import type { Principal, Role } from '@repo/shared-types';

export type AccessDecision = 'allow' | 'unauthenticated' | 'forbidden';

// Also what AuditInterceptor treats as not-a-write: Auditors may do exactly what is never audited.
export const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// @RequireScope() without a name: `read` for read methods, `write` for the rest.
export const METHOD_SCOPE = 'read-or-write';

export const scopeFor = (requiredScope: string, method: string) =>
  requiredScope !== METHOD_SCOPE ? requiredScope : READ_METHODS.has(method.toUpperCase()) ? 'read' : 'write';

// Deny by default: a route with no roles listed admits nobody, and SuperAdmin is never implied. A route with no scope
// is closed to API keys, and a scope only narrows a key's role: the role is still checked.
// Auditors are read-only, except on self-service routes about their own account (e.g. their password).
export function decideAccess(
  principal: Principal | null,
  allowedRoles: readonly Role[] | undefined,
  method: string,
  selfService = false,
  requiredScope?: string,
): AccessDecision {
  if (!principal) return 'unauthenticated';
  if (!allowedRoles?.includes(principal.role)) return 'forbidden';
  if (principal.role === 'Auditor' && !selfService && !READ_METHODS.has(method.toUpperCase())) return 'forbidden';
  if (principal.kind === 'apiKey' && !(requiredScope && principal.scopes?.includes(scopeFor(requiredScope, method)))) return 'forbidden';
  return 'allow';
}
