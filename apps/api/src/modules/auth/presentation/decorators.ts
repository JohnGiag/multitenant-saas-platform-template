import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Principal, Role } from '@repo/shared-types';
import { METHOD_SCOPE } from '../domain/access-policy.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const SELF_SERVICE_KEY = 'auth:selfService';
export const SCOPE_KEY = 'auth:scope';

// Every route needs exactly one of these; a route with neither is denied.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
// Marks a write that only touches the caller's own account, so read-only Auditors may use it too.
export const SelfService = () => SetMetadata(SELF_SERVICE_KEY, true);
// Opens a route to API keys holding this scope; without a name, `read` for read methods and `write` for the rest.
// A route with neither is closed to keys, whatever their role.
export const RequireScope = (scope: string = METHOD_SCOPE) => SetMetadata(SCOPE_KEY, scope);

export interface AuthenticatedRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal | null;
  // Set by RateLimitGuard: the address the rate limits are counted against.
  clientIp?: string;
}

// The tenant always comes from here (token or API key), never from the request body.
export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal!,
);
