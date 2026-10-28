import { z } from 'zod';

// Keep these enums identical to the Prisma enums (checked at compile time in apps/api).
export const RoleSchema = z.enum(['SuperAdmin', 'TenantAdmin', 'User', 'Auditor']);
export type Role = z.infer<typeof RoleSchema>;

export const TenantTierSchema = z.enum(['free', 'pro', 'enterprise']);
export type TenantTier = z.infer<typeof TenantTierSchema>;

export const IdSchema = z.uuid();
export const TimestampSchema = z.iso.datetime();
export const EmailSchema = z.email().max(254).toLowerCase();

// The dashboard's server calls the API on behalf of browsers: it forwards each browser's IP in
// CLIENT_IP_HEADER, proven by DASHBOARD_PROXY_SECRET in DASHBOARD_SECRET_HEADER (see the API's RateLimitGuard).
export const CLIENT_IP_HEADER = 'x-client-ip';
export const DASHBOARD_SECRET_HEADER = 'x-dashboard-secret';
