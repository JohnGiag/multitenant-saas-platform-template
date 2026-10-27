import { Body, Controller, Get, HttpCode, Inject, Post, Res, UnauthorizedException } from '@nestjs/common';
import { SignInSchema, type Principal, type SignInDto, type SignInResult } from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RATE_LIMITER, type RateLimiter } from '../../rate-limit/domain/ports/rate-limiter.port.js';
import { loginAccountKey, loginEmailKey } from '../../rate-limit/domain/rate-limit-policy.js';
import { clearAccountAttempts, countAccountAttempt } from '../../rate-limit/presentation/account-attempts.js';
import { AUTH_SERVICE, type AuthService } from '../domain/ports/auth.port.js';
import { CurrentPrincipal, Public, Roles } from './decorators.js';
import { LocalAuthOnly } from './local-auth-only.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @LocalAuthOnly()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(SignInSchema)) body: SignInDto,
    @Res({ passthrough: true }) res: { setHeader(name: string, value: number): void },
  ): Promise<SignInResult> {
    // Per email, or per account once a tenant is named; on top of the per-IP limit of public routes.
    const key = body.tenantId ? loginAccountKey(body.tenantId, body.email) : loginEmailKey(body.email);
    await countAccountAttempt(this.limiter, key, res);
    const result = await this.auth.signIn(body);
    if (!result) throw new UnauthorizedException('Invalid credentials');
    // A TenantChoice also means the password was right.
    await clearAccountAttempts(this.limiter, key);
    return result;
  }

  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}
