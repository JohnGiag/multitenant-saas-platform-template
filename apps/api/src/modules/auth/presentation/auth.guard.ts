import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Principal, Role } from '@repo/shared-types';
import { decideAccess } from '../domain/access-policy.js';
import { API_KEY_SERVICE, type ApiKeyService } from '../domain/ports/api-key.port.js';
import { AUTH_SERVICE, type AuthService } from '../domain/ports/auth.port.js';
import { IS_PUBLIC_KEY, ROLES_KEY, SELF_SERVICE_KEY, type AuthenticatedRequest } from './decorators.js';

// Registered globally: authenticates every request, then applies the deny-by-default policy.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    @Inject(API_KEY_SERVICE) private readonly apiKeys: ApiKeyService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    req.principal = await this.authenticate(req);
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    const selfService = this.reflector.getAllAndOverride<boolean>(SELF_SERVICE_KEY, targets) ?? false;

    switch (decideAccess(req.principal, roles, req.method, selfService)) {
      case 'unauthenticated':
        throw new UnauthorizedException();
      case 'forbidden':
        throw new ForbiddenException();
      case 'allow':
        return true;
    }
  }

  private async authenticate(req: AuthenticatedRequest): Promise<Principal | null> {
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey === 'string') return this.apiKeys.verify(apiKey);
    // The auth scheme name is case-insensitive (RFC 9110).
    const authorization = req.headers.authorization;
    const bearer = typeof authorization === 'string' ? /^bearer (.+)$/i.exec(authorization) : null;
    return bearer ? this.auth.verifyAccessToken(bearer[1]!) : null;
  }
}
