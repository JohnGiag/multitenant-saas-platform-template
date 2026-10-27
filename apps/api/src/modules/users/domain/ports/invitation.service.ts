import type {
  AcceptedInvitation,
  CreateInvitationDto,
  CursorPage,
  Invitation,
  InvitationPageQuery,
} from '@repo/shared-types';

export const INVITATION_SERVICE = Symbol('InvitationService');

export interface InvitationService {
  // Emails the invitation; throws the mailer's errors, in which case no invitation is left behind.
  invite(tenantId: string, input: CreateInvitationDto): Promise<Invitation | 'already_member'>;
  list(tenantId: string, query: InvitationPageQuery): Promise<CursorPage<Invitation>>;
  // New token and expiry, emailed again; the previous link stops working. Null when not found.
  resend(tenantId: string, id: string): Promise<Invitation | null>;
  revoke(tenantId: string, id: string): Promise<boolean>;
  // 'invalid': unknown, used, revoked or expired token.
  accept(token: string, password: string): Promise<AcceptedInvitation | 'invalid' | 'already_member'>;
}
