import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@repo/shared-types';
import { decideAccess } from '../domain/access-policy.js';
import { IS_PUBLIC_KEY, ROLES_KEY, SCOPE_KEY, SELF_SERVICE_KEY, type AuthenticatedRequest } from './decorators.js';

// Registered globally after RateLimitGuard (see AppModule), so 401s and 403s are rate limited too.
// Applies the deny-by-default policy to the principal AuthGuard attached.
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const selfService = this.reflector.getAllAndOverride<boolean>(SELF_SERVICE_KEY, targets) ?? false;
    const scope = this.reflector.getAllAndOverride<string | undefined>(SCOPE_KEY, targets);

    switch (decideAccess(req.principal ?? null, roles, req.method, selfService, scope)) {
      case 'unauthenticated':
        throw new UnauthorizedException();
      case 'forbidden':
        throw new ForbiddenException();
      case 'allow':
        return true;
    }
  }
}
