import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { PrincipalSchema, SignInResultSchema, SignInSchema, type Principal, type SignInDto, type SignInResult } from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { RATE_LIMITER, type RateLimiter } from '../../rate-limit/domain/ports/rate-limiter.port.js';
import { LOGIN_CEILING_LIMIT, loginAccountKey, loginEmailKey } from '../../rate-limit/domain/rate-limit-policy.js';
import { clearAccountAttempts, countAccountAttempt } from '../../rate-limit/presentation/account-attempts.js';
import { AUTH_SERVICE, type AuthService } from '../domain/ports/auth.port.js';
import { CurrentPrincipal, Public, Roles, type AuthenticatedRequest } from './decorators.js';
import { LocalAuthOnly } from './local-auth-only.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @LocalAuthOnly()
  @ApiDoc(
    'Sign in with email and password. If the password matches accounts in several tenants, the answer lists them: sign in again with the chosen `tenantId`',
    SignInResultSchema,
  )
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(SignInSchema)) body: SignInDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: { setHeader(name: string, value: number): void },
  ): Promise<SignInResult> {
    // Per email, or per account once a tenant is named: for this IP, and for all IPs together at a higher ceiling.
    const ip = req.clientIp!;
    const key = body.tenantId ? loginAccountKey(body.tenantId, body.email) : loginEmailKey(body.email);
    await countAccountAttempt(this.limiter, key, ip, LOGIN_CEILING_LIMIT, res);
    const result = await this.auth.signIn(body);
    if (!result) throw new UnauthorizedException('Invalid credentials');
    // A TenantChoice also means the password was right.
    await clearAccountAttempts(this.limiter, key, ip);
    return result;
  }

  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @ApiDoc('The caller: user or API key, tenant, role and tier', PrincipalSchema)
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}
