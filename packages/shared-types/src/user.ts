import { z } from 'zod';
import { EmailSchema, IdSchema, RoleSchema, TimestampSchema } from './common.js';

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

export const CreateUserSchema = z.object({
  email: EmailSchema,
  // SuperAdmin is never assignable through tenant-facing input.
  role: RoleSchema.exclude(['SuperAdmin']).optional(),
});
export type CreateUserDto = z.infer<typeof CreateUserSchema>;
