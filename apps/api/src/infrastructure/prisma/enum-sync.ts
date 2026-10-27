import type { Role, TenantTier } from '@repo/shared-types';
import type { Role as DbRole, TenantTier as DbTenantTier } from '../../generated/prisma/enums.js';

// Compile-time guard: fails the build if the Prisma enums and the shared Zod enums drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type RoleInSync = Assert<Same<Role, DbRole>>;
export type TenantTierInSync = Assert<Same<TenantTier, DbTenantTier>>;
