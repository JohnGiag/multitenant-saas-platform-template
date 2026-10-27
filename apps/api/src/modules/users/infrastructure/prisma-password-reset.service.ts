import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { hashPassword } from '../../auth/infrastructure/password.js';
import { SYSTEM_MAILER, type SystemMailer } from '../../mail/domain/ports/system-mailer.js';
import { passwordResetEmail } from '../domain/emails.js';
import { hashOneTimeToken, newOneTimeToken, PASSWORD_RESET_TTL_MS } from '../domain/one-time-token.js';
import type { PasswordResetService } from '../domain/ports/password-reset.service.js';
import { appLink } from './app-links.js';

@Injectable()
export class PrismaPasswordResetService implements PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SYSTEM_MAILER) private readonly mailer: SystemMailer,
  ) {}

  async request(tenantId: string, email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      select: { id: true, passwordHash: true, tenant: { select: { name: true } } },
    });
    // Unknown, or signs in through an external provider: nothing to reset.
    if (!user?.passwordHash) return;
    const { token, hash } = newOneTimeToken();
    // Only the newest link works.
    await this.prisma.$transaction([
      this.prisma.passwordReset.deleteMany({ where: { userId: user.id } }),
      this.prisma.passwordReset.create({
        data: { tenantId, userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
      }),
    ]);
    const link = appLink(this.config, 'reset-password', token);
    const { subject, text } = passwordResetEmail({ tenantName: user.tenant.name, link });
    await this.mailer.send({ to: email, subject, text });
  }

  async confirm(token: string, password: string) {
    const tokenHash = hashOneTimeToken(token);
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, user: { select: { tenantId: true, email: true } } },
    });
    if (!reset || reset.expiresAt <= new Date()) return 'invalid' as const;
    const passwordHash = await hashPassword(password);
    return this.prisma.$transaction(async (tx) => {
      // Consuming the token is the guard: a second use of the same link finds nothing to delete.
      const { count } = await tx.passwordReset.deleteMany({ where: { id: reset.id, tokenHash } });
      if (count === 0) return 'invalid' as const;
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
      return { tenantId: reset.user.tenantId, email: reset.user.email };
    });
  }
}
