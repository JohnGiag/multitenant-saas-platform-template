import type { AssignableRole, CursorPage, User, UserPageQuery } from '@repo/shared-types';
import type { MembershipDecision } from '../membership.js';

export const USER_REPOSITORY = Symbol('UserRepository');

type Refused = Exclude<MembershipDecision, 'ok'> | 'not_found';

// Users are created only by accepting an invitation (InvitationService).
export interface UserRepository {
  list(tenantId: string, query: UserPageQuery): Promise<CursorPage<User>>;
  updateRole(tenantId: string, id: string, role: AssignableRole): Promise<User | Refused>;
  remove(tenantId: string, id: string): Promise<'deleted' | Refused>;
  // 'no_password': the account signs in through an external provider (e.g. Clerk).
  changePassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<'changed' | 'wrong_password' | 'no_password'>;
}
