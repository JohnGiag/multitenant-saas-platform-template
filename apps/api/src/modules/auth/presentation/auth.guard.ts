import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Principal } from '@repo/shared-types';
import { API_KEY_SERVICE, type ApiKeyService } from '../domain/ports/api-key.port.js';
import { AUTH_SERVICE, type AuthService } from '../domain/ports/auth.port.js';
import { IS_PUBLIC_KEY, type AuthenticatedRequest } from './decorators.js';

// Registered globally, first: only works out who is calling and never rejects, so callers with a bad
// token or API key still reach RateLimitGuard (as anonymous, per IP). AccessGuard then decides.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    @Inject(API_KEY_SERVICE) private readonly apiKeys: ApiKeyService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    req.principal = await this.authenticate(req);
    return true;
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
