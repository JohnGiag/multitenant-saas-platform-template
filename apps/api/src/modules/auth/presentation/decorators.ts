import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Principal, Role } from '@repo/shared-types';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';
export const SELF_SERVICE_KEY = 'auth:selfService';

// Every route needs exactly one of these; a route with neither is denied.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
// Marks a write that only touches the caller's own account, so read-only Auditors may use it too.
export const SelfService = () => SetMetadata(SELF_SERVICE_KEY, true);

export interface AuthenticatedRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal | null;
}

// The tenant always comes from here (token or API key), never from the request body.
export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal!,
);
