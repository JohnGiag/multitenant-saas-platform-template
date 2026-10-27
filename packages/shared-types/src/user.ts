import { z } from 'zod';
import { EmailSchema, IdSchema, RoleSchema, TimestampSchema } from './common.js';
import { pageQuery } from './pagination.js';

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
