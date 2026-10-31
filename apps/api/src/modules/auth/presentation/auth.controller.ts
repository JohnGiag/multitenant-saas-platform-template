import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import {
  AuthTokenSchema,
  PrincipalSchema,
  RefreshTokenSchema,
  SignInResultSchema,
  SignInSchema,
  type AuthToken,
  type Principal,
  type RefreshTokenDto,
  type SignInDto,
  type SignInResult,
} from '@repo/shared-types';
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

  @Public()
  @LocalAuthOnly()
  @ApiDoc(
    'Swap a refresh token for a new access and refresh token. Each works once: replaying an old one ends the session (401)',
    AuthTokenSchema,
  )
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodValidationPipe(RefreshTokenSchema)) { refreshToken }: RefreshTokenDto): Promise<AuthToken> {
    const tokens = await this.auth.refresh(refreshToken);
    if (!tokens) throw new UnauthorizedException('Invalid refresh token');
    return tokens;
  }

  // Public: an expired access token must not stop anyone from signing out. The refresh token is the credential.
  @Public()
  @LocalAuthOnly()
  @ApiDoc('Sign out: ends the session of this refresh token, and its access tokens stop working at once')
  @Post('logout')
  @HttpCode(204)
  logout(@Body(new ZodValidationPipe(RefreshTokenSchema)) { refreshToken }: RefreshTokenDto): Promise<void> {
    return this.auth.signOut(refreshToken);
  }

  @Roles('SuperAdmin', 'TenantAdmin', 'User', 'Auditor')
  @ApiDoc('The caller: user or API key, tenant, role and tier', PrincipalSchema)
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Principal {
    return principal;
  }
}
