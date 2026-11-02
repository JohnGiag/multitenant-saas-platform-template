import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AcceptedInvitation,
  CreateInvitationDto,
  CursorPage,
  Invitation,
  InvitationPageQuery,
} from '@repo/shared-types';
import { toCursorPage } from '../../../common/cursor-page.js';
import { hasCode } from '../../../common/prisma-errors.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { hashPassword } from '../../auth/infrastructure/password.js';
import { SYSTEM_MAILER, type SystemMailer } from '../../mail/domain/ports/system-mailer.js';
import { invitationEmail } from '../domain/emails.js';
import { hashOneTimeToken, INVITATION_TTL_MS, newOneTimeToken } from '../domain/one-time-token.js';
import type { InvitationService } from '../domain/ports/invitation.service.js';
import { recordEvent } from '../../events/infrastructure/outbox.js';
import { appLink } from './app-links.js';

// Never selects tokenHash.
const PUBLIC_FIELDS = { id: true, tenantId: true, email: true, role: true, expiresAt: true, createdAt: true } as const;
type PublicRow = Prisma.InvitationGetPayload<{ select: typeof PUBLIC_FIELDS }>;

const toInvitation = (row: PublicRow): Invitation => ({
  ...row,
  // The database refuses SuperAdmin invitations (check constraint).
  role: row.role as Invitation['role'],
  expiresAt: row.expiresAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class PrismaInvitationService implements InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SYSTEM_MAILER) private readonly mailer: SystemMailer,
  ) {}

  async invite(tenantId: string, { email, role }: CreateInvitationDto) {
    if (await this.prisma.user.count({ where: { tenantId, email } })) return 'already_member' as const;
    const { token, hash } = newOneTimeToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    // Inviting the same email again replaces the pending invitation, so its old link stops working.
    const row = await this.prisma.invitation.upsert({
      where: { tenantId_email: { tenantId, email } },
      create: { tenantId, email, role, tokenHash: hash, expiresAt },
      update: { role, tokenHash: hash, expiresAt },
      select: PUBLIC_FIELDS,
    });
    try {
      await this.email(row, token);
    } catch (error) {
      // An invitation nobody received is useless, and its token exists nowhere else.
      await this.prisma.invitation.deleteMany({ where: { id: row.id } });
      throw error;
    }
    return toInvitation(row);
  }

  async list(tenantId: string, { cursor, limit }: InvitationPageQuery): Promise<CursorPage<Invitation>> {
    const rows = await this.prisma.invitation.findMany({
      where: { tenantId, ...(cursor && { id: { gt: cursor } }) },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: PUBLIC_FIELDS,
    });
    return toCursorPage(rows.map(toInvitation), limit, (i) => i.id);
  }

  async resend(tenantId: string, id: string): Promise<Invitation | null> {
    const { token, hash } = newOneTimeToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const { count } = await this.prisma.invitation.updateMany({
      where: { id, tenantId },
      data: { tokenHash: hash, expiresAt },
    });
    if (count === 0) return null;
    const row = await this.prisma.invitation.findUniqueOrThrow({ where: { id }, select: PUBLIC_FIELDS });
    // If sending fails the old link is already void; the admin can resend again.
    await this.email(row, token);
    return toInvitation(row);
  }

  async revoke(tenantId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.invitation.deleteMany({ where: { id, tenantId } });
    return count === 1;
  }

  async accept(token: string, password: string): Promise<AcceptedInvitation | 'invalid' | 'already_member'> {
    const tokenHash = hashOneTimeToken(token);
    // Checked before hashing the password, so a guessed token costs no Argon2 work.
    const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.expiresAt <= new Date()) return 'invalid';
    const passwordHash = await hashPassword(password);
    let joined;
    try {
      joined = await this.prisma.$transaction(async (tx) => {
        // Consuming the token is the guard: a second accept of the same link finds nothing to delete.
        const { count } = await tx.invitation.deleteMany({ where: { id: invitation.id, tokenHash } });
        if (count === 0) return 'invalid' as const;
        const { tenantId, email, role } = invitation;
        const user = await tx.user.create({ data: { tenantId, email, role, passwordHash }, select: { id: true } });
        // A public route, so AuditInterceptor does not see it; recorded in the same commit as the account.
        await tx.auditLog.create({
          data: { tenantId, actorKind: 'user', actorId: user.id, actorRole: role, method: 'POST', route: '/v1/invitations/accept', status: 201 },
        });
        await recordEvent(tx, tenantId, 'member.joined', { userId: user.id, role });
        return { tenantId, email };
      });
    } catch (error) {
      // Became a member another way in the meantime.
      if (hasCode(error, 'P2002')) return 'already_member';
      throw error;
    }
    return joined;
  }

  private async email(row: PublicRow, token: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: row.tenantId }, select: { name: true } });
    const link = appLink(this.config, 'accept-invitation', token);
    const { subject, text } = invitationEmail({ tenantName: tenant.name, role: row.role, link, expiresAt: row.expiresAt });
    await this.mailer.send({ to: row.email, subject, text });
  }
}
