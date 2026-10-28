import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { MAX_ACCOUNTS_PER_EMAIL } from '../../auth/domain/account-lookup.js';
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

  async request(email: string): Promise<void> {
    // Across tenants (see MAX_ACCOUNTS_PER_EMAIL): the links only ever go to this email's owner. Accounts
    // that sign in through an external provider have no password to reset.
    const users = await this.prisma.user.findMany({
      where: { email, passwordHash: { not: null } },
      orderBy: { id: 'asc' },
      take: MAX_ACCOUNTS_PER_EMAIL,
      select: { id: true, tenantId: true, tenant: { select: { name: true } } },
    });
    // One email per account, each naming its tenant; one failing does not stop the others.
    await Promise.all(
      users.map(async (user) => {
        const { token, hash } = newOneTimeToken();
        // Only the newest link works.
        await this.prisma.$transaction([
          this.prisma.passwordReset.deleteMany({ where: { tenantId: user.tenantId, userId: user.id } }),
          this.prisma.passwordReset.create({
            data: { tenantId: user.tenantId, userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
          }),
        ]);
        const link = appLink(this.config, 'reset-password', token);
        const { subject, text } = passwordResetEmail({ tenantName: user.tenant.name, link });
        await this.mailer.send({ to: email, subject, text });
      }),
    );
  }

  async confirm(token: string, password: string) {
    const tokenHash = hashOneTimeToken(token);
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, user: { select: { tenantId: true, email: true, role: true } } },
    });
    if (!reset || reset.expiresAt <= new Date()) return 'invalid' as const;
    const passwordHash = await hashPassword(password);
    return this.prisma.$transaction(async (tx) => {
      // Consuming the token is the guard: a second use of the same link finds nothing to delete.
      const { count } = await tx.passwordReset.deleteMany({ where: { id: reset.id, tokenHash } });
      if (count === 0) return 'invalid' as const;
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
      // A public route, so AuditInterceptor does not see it; recorded in the same commit as the change.
      await tx.auditLog.create({
        data: {
          tenantId: reset.user.tenantId,
          actorKind: 'user',
          actorId: reset.userId,
          actorRole: reset.user.role,
          method: 'POST',
          route: '/v1/auth/password-reset/confirm',
          status: 204,
        },
      });
      return { tenantId: reset.user.tenantId, email: reset.user.email };
    });
  }
}
