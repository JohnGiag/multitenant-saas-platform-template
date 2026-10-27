import { z } from 'zod';

// Keep these enums identical to the Prisma enums (checked at compile time in apps/api).
export const RoleSchema = z.enum(['SuperAdmin', 'TenantAdmin', 'User', 'Auditor']);
export type Role = z.infer<typeof RoleSchema>;

export const TenantTierSchema = z.enum(['free', 'pro', 'enterprise']);
export type TenantTier = z.infer<typeof TenantTierSchema>;

export const IdSchema = z.uuid();
export const TimestampSchema = z.iso.datetime();
export const EmailSchema = z.email().max(254).toLowerCase();
