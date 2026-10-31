import { z } from 'zod';
import { EmailSchema, IdSchema, RoleSchema, TimestampSchema } from './common.js';
import { cursorPage, pageQuery } from './pagination.js';

// Never carries passwordHash: this is the shape that leaves the API.
export const UserSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  email: EmailSchema,
  role: RoleSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type User = z.infer<typeof UserSchema>;

// SuperAdmin is never assignable through tenant-facing input.
export const AssignableRoleSchema = RoleSchema.exclude(['SuperAdmin']);
export type AssignableRole = z.infer<typeof AssignableRoleSchema>;

// Length is what matters (NIST SP 800-63B); the upper bound only caps hashing work.
export const PasswordSchema = z.string().min(12).max(256);

export const UpdateUserSchema = z.object({ role: AssignableRoleSchema });
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: PasswordSchema,
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

export const UserPageQuerySchema = pageQuery(IdSchema);
export type UserPageQuery = z.infer<typeof UserPageQuerySchema>;

export const UserSessionSchema = z.object({ id: IdSchema, createdAt: TimestampSchema, expiresAt: TimestampSchema });
export type UserSession = z.infer<typeof UserSessionSchema>;

// What the core tables hold about one person (ISO 27701). Their actions are in GET /v1/audit-logs?actorId=<id>.
export const UserExportSchema = z.object({ user: UserSchema, sessions: cursorPage(UserSessionSchema) });
export type UserExport = z.infer<typeof UserExportSchema>;
