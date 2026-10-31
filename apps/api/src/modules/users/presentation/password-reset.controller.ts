import { BadRequestException, Body, Controller, HttpCode, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import {
  PasswordResetConfirmSchema,
  PasswordResetRequestSchema,
  type PasswordResetConfirmDto,
  type PasswordResetRequestDto,
} from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ACCESS_REVOCATIONS, type AccessRevocations } from '../../auth/domain/ports/access-revocations.port.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Public, type AuthenticatedRequest } from '../../auth/presentation/decorators.js';
import { RATE_LIMITER, type RateLimiter } from '../../rate-limit/domain/ports/rate-limiter.port.js';
import { loginAccountKey, loginEmailKey, passwordResetKey, RESET_CEILING_LIMIT } from '../../rate-limit/domain/rate-limit-policy.js';
import { clearAccountAttempts, countAccountAttempt } from '../../rate-limit/presentation/account-attempts.js';
import { PASSWORD_RESET_SERVICE, type PasswordResetService } from '../domain/ports/password-reset.service.js';
import { LocalAuthOnly } from '../../auth/presentation/local-auth-only.js';

@LocalAuthOnly()
@Controller('auth/password-reset')
export class PasswordResetController {
  private readonly logger = new Logger('PasswordReset');

  constructor(
    @Inject(PASSWORD_RESET_SERVICE) private readonly resets: PasswordResetService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(ACCESS_REVOCATIONS) private readonly revocations: AccessRevocations,
  ) {}

  // Always 202, sent before any lookup or email: neither the answer nor its timing tells whether
  // the email has accounts. Limited per email, so nobody can flood an inbox.
  @Public()
  @ApiDoc(
    'Request password reset links: always 202, whether or not the email has accounts. Each account with it gets a 1-hour link naming its tenant',
    null,
  )
  @Post()
  @HttpCode(202)
  async request(
    @Body(new ZodValidationPipe(PasswordResetRequestSchema)) { email }: PasswordResetRequestDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: { setHeader(name: string, value: number): void },
  ): Promise<void> {
    await countAccountAttempt(this.limiter, passwordResetKey(email), req.clientIp!, RESET_CEILING_LIMIT, res);
    // shortcut: in-process, not queued (the token must not sit in Redis); a crash before sending loses
    // the email and the user simply asks again.
    void this.resets.request(email).catch((err: unknown) =>
      // Never the email itself (PII) in the log.
      this.logger.warn(`Password reset email failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  @Public()
  @ApiDoc('Set a new password with the emailed token; also lifts any sign-in lockout and ends every session of the account')
  @Post('confirm')
  @HttpCode(204)
  async confirm(
    @Body(new ZodValidationPipe(PasswordResetConfirmSchema)) { token, password }: PasswordResetConfirmDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const result = await this.resets.confirm(token, password);
    if (result === 'invalid') throw new BadRequestException('This reset link is invalid or has expired');
    await this.revocations.revoke('user', result.userId);
    // A user locked out by failed logins can sign in again with the new password, either way: the lockout of
    // this IP and the all-IPs ceiling (the owner proved themselves with the emailed token).
    for (const key of [loginAccountKey(result.tenantId, result.email), loginEmailKey(result.email)]) {
      await clearAccountAttempts(this.limiter, key, req.clientIp!);
      await clearAccountAttempts(this.limiter, key);
    }
  }
}
