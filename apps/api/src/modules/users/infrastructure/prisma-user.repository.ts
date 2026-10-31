import { Injectable } from '@nestjs/common';
import type { AssignableRole, CursorPage, Role, User, UserExport, UserPageQuery } from '@repo/shared-types';
import { toCursorPage } from '../../../common/cursor-page.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { hashPassword, verifyPassword } from '../../auth/infrastructure/password.js';
import { decideMembershipChange } from '../domain/membership.js';
import type { UserRepository } from '../domain/ports/user.repository.js';

// Never selects passwordHash, so it cannot leak into a response by accident.
const PUBLIC_FIELDS = { id: true, tenantId: true, email: true, role: true, createdAt: true, updatedAt: true } as const;

type PublicRow = Prisma.UserGetPayload<{ select: typeof PUBLIC_FIELDS }>;

const toUser = (row: PublicRow): User => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, { cursor, limit }: UserPageQuery): Promise<CursorPage<User>> {
    // UUIDv7 ids are time-ordered: served by the (tenant_id, id) index.
    const rows = await this.prisma.user.findMany({
      where: { tenantId, ...(cursor && { id: { gt: cursor } }) },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: PUBLIC_FIELDS,
    });
    return toCursorPage(rows.map(toUser), limit, (u) => u.id);
  }

  async exportRecords(tenantId: string, id: string, { cursor, limit }: UserPageQuery): Promise<UserExport | null> {
    const user = await this.prisma.user.findFirst({ where: { id, tenantId }, select: PUBLIC_FIELDS });
    if (!user) return null;
    // A person's sessions are few, so sorting the (tenant_id, user_id) index's matches costs little.
    const sessions = await this.prisma.authSession.findMany({
      where: { tenantId, userId: id, ...(cursor && { id: { gt: cursor } }) },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: { id: true, createdAt: true, expiresAt: true },
    });
    const items = sessions.map((s) => ({ id: s.id, createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt.toISOString() }));
    return { user: toUser(user), sessions: toCursorPage(items, limit, (s) => s.id) };
  }

  updateRole(tenantId: string, id: string, role: AssignableRole) {
    return this.changeMembership(tenantId, id, role, async (tx) =>
      toUser(await tx.user.update({ where: { id }, data: { role }, select: PUBLIC_FIELDS })),
    );
  }

  remove(tenantId: string, id: string) {
    return this.changeMembership(tenantId, id, null, async (tx) => {
      await tx.user.delete({ where: { id } });
      return 'deleted' as const;
    });
  }

  // Locks the tenant's TenantAdmin rows first: two admins demoting or removing each other at the same
  // time are serialized, so the second sees the first's change and the tenant keeps an admin.
  private changeMembership<T>(
    tenantId: string,
    id: string,
    newRole: Role | null,
    apply: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE tenant_id = ${tenantId}::uuid AND role = 'TenantAdmin' ORDER BY id FOR UPDATE`;
      const target = await tx.user.findFirst({ where: { id, tenantId }, select: { role: true } });
      if (!target) return 'not_found' as const;
      const decision = decideMembershipChange(target.role, newRole, admins.filter((a) => a.id !== id).length);
      return decision === 'ok' ? apply(tx) : decision;
    });
  }

  async changePassword(tenantId: string, userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { passwordHash: true } });
    if (!user?.passwordHash) return 'no_password' as const;
    if (!(await verifyPassword(user.passwordHash, currentPassword))) return 'wrong_password' as const;
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: { id: userId, tenantId }, data: { passwordHash } }),
      // Whoever had the old password may hold a session.
      this.prisma.authSession.deleteMany({ where: { userId, tenantId } }),
    ]);
    return 'changed' as const;
  }
}
