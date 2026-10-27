import { z } from 'zod';
import { EmailSchema, IdSchema, TimestampSchema } from './common.js';
import { pageQuery } from './pagination.js';
import { AssignableRoleSchema, PasswordSchema } from './user.js';

// Users join only by invitation: they choose their own password when they accept it.
export const CreateInvitationSchema = z.object({
  email: EmailSchema,
  role: AssignableRoleSchema.optional(),
});
export type CreateInvitationDto = z.infer<typeof CreateInvitationSchema>;

// Never carries the token: it only ever travels in the invitation email.
export const InvitationSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  email: EmailSchema,
  role: AssignableRoleSchema,
  expiresAt: TimestampSchema,
  createdAt: TimestampSchema,
});
export type Invitation = z.infer<typeof InvitationSchema>;

export const InvitationPageQuerySchema = pageQuery(IdSchema);
export type InvitationPageQuery = z.infer<typeof InvitationPageQuerySchema>;

// The single-use token from an emailed link (base64url).
const OneTimeTokenSchema = z.string().min(1).max(256);

export const AcceptInvitationSchema = z.object({ token: OneTimeTokenSchema, password: PasswordSchema });
export type AcceptInvitationDto = z.infer<typeof AcceptInvitationSchema>;

// What the client needs to sign in next (login takes the tenant).
export const AcceptedInvitationSchema = z.object({ tenantId: IdSchema, email: EmailSchema });
export type AcceptedInvitation = z.infer<typeof AcceptedInvitationSchema>;

export const PasswordResetRequestSchema = z.object({ tenantId: IdSchema, email: EmailSchema });
export type PasswordResetRequestDto = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmSchema = z.object({ token: OneTimeTokenSchema, password: PasswordSchema });
export type PasswordResetConfirmDto = z.infer<typeof PasswordResetConfirmSchema>;
