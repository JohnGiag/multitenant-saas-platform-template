import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Principal, Role } from '@repo/shared-types';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

// Every route needs exactly one of these; a route with neither is denied.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthenticatedRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal | null;
}

// The tenant always comes from here (token or API key), never from the request body.
export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal => ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal!,
);
