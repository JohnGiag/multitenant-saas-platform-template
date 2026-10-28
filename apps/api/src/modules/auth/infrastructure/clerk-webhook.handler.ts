import { Inject, Injectable, Logger } from '@nestjs/common';
import { EmailSchema } from '@repo/shared-types';
import { z } from 'zod';
import { hasCode } from '../../../common/prisma-errors.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { TENANT_REPOSITORY, type TenantRepository } from '../../tenancy/domain/ports/tenant.repository.js';

const OrganizationSchema = z.object({ id: z.string().min(1), name: z.string() });
const DeletedSchema = z.object({ id: z.string().min(1) });
const MembershipSchema = z.object({
  role: z.string(),
  organization: OrganizationSchema,
  public_user_data: z.object({ user_id: z.string().min(1), identifier: z.string() }),
});
const ClerkUserSchema = z.object({
  id: z.string().min(1),
  primary_email_address_id: z.string().nullable(),
  email_addresses: z.array(z.object({ id: z.string(), email_address: z.string() })),
});

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const membershipId = (orgId: string, userId: string) => `${orgId}/${userId}`;

// Mirrors Clerk into our tenants and users (Clerk is where they are created and removed).
// Every event is idempotent and order-independent: Svix retries deliveries, late and in any order.
// Deletions leave a tombstone (ClerkDeletion), so a create or update older than it changes nothing.
@Injectable()
export class ClerkWebhookHandler {
  private readonly logger = new Logger('ClerkWebhooks');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepository,
  ) {}

  // `at`: when Clerk created the event (the same on every retry). Throws a ZodError for a payload
  // that is not what the event type promises.
  async handle(type: string, data: unknown, at: Date): Promise<void> {
    switch (type) {
      case 'organization.created':
      case 'organization.updated':
        await this.upsertTenant(OrganizationSchema.parse(data), at);
        return;
      case 'organization.deleted':
        return this.deleteTenant(DeletedSchema.parse(data).id, at);
      case 'organizationMembership.created':
        return this.addMember(MembershipSchema.parse(data), at);
      case 'organizationMembership.deleted': {
        // Clerk decides membership, so this bypasses our last-TenantAdmin rule.
        const { organization, public_user_data } = MembershipSchema.parse(data);
        await this.tombstone(membershipId(organization.id, public_user_data.user_id), at);
        await this.prisma.user.deleteMany({
          // createdAt (the membership event's time): a stale deletion must not remove a member re-added after it.
          where: { clerkUserId: public_user_data.user_id, tenant: { clerkOrgId: organization.id }, createdAt: { lt: at } },
        });
        return;
      }
      case 'user.updated':
        return this.updateEmail(ClerkUserSchema.parse(data));
      case 'user.deleted': {
        const { id } = DeletedSchema.parse(data);
        await this.tombstone(id, at);
        await this.prisma.user.deleteMany({ where: { clerkUserId: id } });
        return;
      }
      // organizationMembership.updated (roles are ours) and every other event: nothing to mirror.
      default:
        return;
    }
  }

  // Null when the organization was deleted after this event.
  private async upsertTenant({ id, name }: z.infer<typeof OrganizationSchema>, at: Date) {
    if (await this.deletedSince(at, id)) return null;
    return this.prisma.tenant.upsert({
      where: { clerkOrgId: id },
      create: { clerkOrgId: id, name },
      update: { name },
      select: { id: true },
    });
  }

  private async addMember({ role, organization, public_user_data }: z.infer<typeof MembershipSchema>, at: Date) {
    const clerkUserId = public_user_data.user_id;
    if (await this.deletedSince(at, clerkUserId, membershipId(organization.id, clerkUserId))) return;
    const email = EmailSchema.safeParse(public_user_data.identifier);
    if (!email.success) {
      this.logger.warn(`Membership of Clerk user ${clerkUserId} skipped: its identifier is not an email`);
      return;
    }
    // Out-of-order delivery: the membership can arrive before organization.created.
    const tenant = await this.upsertTenant(organization, at);
    if (!tenant) return;
    try {
      const existing = await this.prisma.user.findFirst({
        where: { tenantId: tenant.id, OR: [{ clerkUserId }, { email: email.data }] },
        select: { id: true },
      });
      // Already a member (redelivery, or a local account with the same email): link it, keep its role.
      if (existing) await this.prisma.user.update({ where: { id: existing.id }, data: { clerkUserId } });
      else {
        // Only the starting role comes from Clerk; after that roles are managed here.
        const startingRole = role === 'org:admin' ? 'TenantAdmin' : 'User';
        // createdAt on Clerk's clock, so organizationMembership.deleted compares like with like.
        await this.prisma.user.create({
          data: { tenantId: tenant.id, email: email.data, role: startingRole, clerkUserId, createdAt: at },
        });
      }
    } catch (error) {
      // A concurrent delivery of the same event created it first.
      if (hasCode(error, 'P2002')) return;
      throw error;
    }
  }

  // Organization deleted in Clerk: the tenant and everything in it go too.
  private async deleteTenant(clerkOrgId: string, at: Date) {
    // Before the lookup: the deletion can arrive before organization.created.
    await this.tombstone(clerkOrgId, at);
    const tenant = await this.prisma.tenant.findUnique({ where: { clerkOrgId }, select: { id: true } });
    if (!tenant) return;
    // Answered 204 all the same: Svix retrying the event would never change the outcome.
    if ((await this.tenants.delete(tenant.id)) === 'protected') {
      this.logger.warn(`Clerk organization ${clerkOrgId} was deleted, but it is the platform tenant: kept`);
    }
  }

  private async updateEmail({ id, primary_email_address_id, email_addresses }: z.infer<typeof ClerkUserSchema>) {
    const primary = email_addresses.find((address) => address.id === primary_email_address_id);
    const email = EmailSchema.safeParse(primary?.email_address);
    if (!email.success) return;
    // One member at a time: a single updateMany would fail as a whole on one clash, in every tenant.
    const members = await this.prisma.user.findMany({ where: { clerkUserId: id }, select: { id: true } });
    for (const member of members) {
      try {
        await this.prisma.user.update({ where: { id: member.id }, data: { email: email.data } });
      } catch (error) {
        // Another member of that tenant already has the email: keep the old one there. Gone since: nothing to do.
        if (hasCode(error, 'P2002')) {
          this.logger.warn(`Email change of Clerk user ${id} skipped in one tenant: the address is taken there`);
        } else if (!hasCode(error, 'P2025')) throw error;
      }
    }
  }

  // Keeps the newest deletion time: a late retry of an older deletion must not move it back.
  private async tombstone(clerkId: string, at: Date) {
    const { count } = await this.prisma.clerkDeletion.updateMany({
      where: { clerkId, deletedAt: { lt: at } },
      data: { deletedAt: at },
    });
    if (count === 0) await this.prisma.clerkDeletion.createMany({ data: { clerkId, deletedAt: at }, skipDuplicates: true });
    // Svix stops retrying long before this, so older tombstones guard against nothing.
    await this.prisma.clerkDeletion.deleteMany({ where: { deletedAt: { lt: new Date(Date.now() - TOMBSTONE_TTL_MS) } } });
  }

  private async deletedSince(at: Date, ...clerkIds: string[]) {
    return (await this.prisma.clerkDeletion.count({ where: { clerkId: { in: clerkIds }, deletedAt: { gte: at } } })) > 0;
  }
}
