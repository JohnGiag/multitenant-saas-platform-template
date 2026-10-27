import { BadRequestException, Body, Controller, HttpCode, Inject, Logger, Post, Res } from '@nestjs/common';
import {
  PasswordResetConfirmSchema,
  PasswordResetRequestSchema,
  type PasswordResetConfirmDto,
  type PasswordResetRequestDto,
} from '@repo/shared-types';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Public } from '../../auth/presentation/decorators.js';
import { RATE_LIMITER, type RateLimiter } from '../../rate-limit/domain/ports/rate-limiter.port.js';
import { loginAccountKey, passwordResetKey } from '../../rate-limit/domain/rate-limit-policy.js';
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
  ) {}

  // Always 202, sent before any lookup or email: neither the answer nor its timing tells whether
  // the account exists. Limited per account, so nobody can flood a user's inbox.
  @Public()
  @Post()
  @HttpCode(202)
  async request(
    @Body(new ZodValidationPipe(PasswordResetRequestSchema)) { tenantId, email }: PasswordResetRequestDto,
    @Res({ passthrough: true }) res: { setHeader(name: string, value: number): void },
  ): Promise<void> {
    await countAccountAttempt(this.limiter, passwordResetKey(tenantId, email), res);
    // shortcut: in-process, not queued (the token must not sit in Redis); a crash before sending loses
    // the email and the user simply asks again.
    void this.resets.request(tenantId, email).catch((err: unknown) =>
      this.logger.warn(`Password reset email for tenant ${tenantId} failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  @Public()
  @Post('confirm')
  @HttpCode(204)
  async confirm(
    @Body(new ZodValidationPipe(PasswordResetConfirmSchema)) { token, password }: PasswordResetConfirmDto,
  ): Promise<void> {
    const result = await this.resets.confirm(token, password);
    if (result === 'invalid') throw new BadRequestException('This reset link is invalid or has expired');
    // A user locked out by failed logins can sign in again with the new password.
    await clearAccountAttempts(this.limiter, loginAccountKey(result.tenantId, result.email));
  }
}
