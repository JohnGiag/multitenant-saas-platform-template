import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SignInSchema, type AuthToken, type Principal, type SignInDto } from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RATE_LIMITER, type RateLimiter } from '../../rate-limit/domain/ports/rate-limiter.port.js';
import {
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_ACCOUNT_WINDOW_MS,
  loginAccountKey,
} from '../../rate-limit/domain/rate-limit-policy.js';
import { AUTH_SERVICE, type AuthService } from '../domain/ports/auth.port.js';
import { CurrentPrincipal, Public, Roles } from './decorators.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(SignInSchema)) body: SignInDto,
    @Res({ passthrough: true }) res: { setHeader(name: string, value: number): void },
  ): Promise<AuthToken> {
    // Checked before the password, on top of the per-IP limit; fails closed like other public routes.
    const key = loginAccountKey(body.tenantId, body.email);
    const attempt = await this.limiter
      .consume(key, LOGIN_ACCOUNT_LIMIT, LOGIN_ACCOUNT_WINDOW_MS)
      .catch(() => {
        throw new ServiceUnavailableException();
      });
    if (!attempt.allowed) {
      res.setHeader('Retry-After', attempt.resetSec);
      throw new HttpException('Too many login attempts for this account', HttpStatus.TOO_MANY_REQUESTS);
    }

    const token = await this.auth.signIn(body);
    if (!token) throw new UnauthorizedException('Invalid credentials');
    // Only the right password clears the account's failures. If Redis hiccups, the bucket just expires.
    await this.limiter.reset(key).catch(() => undefined);
    return token;
  }

  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}
