import type { Role } from '@repo/shared-types';

export type MembershipDecision = 'ok' | 'protected' | 'last_admin';

// Whether a user's role may change to `newRole` (null = the user is removed), given how many
// other TenantAdmins the tenant has.
export function decideMembershipChange(currentRole: Role, newRole: Role | null, otherAdmins: number): MembershipDecision {
  // Platform accounts: never changed or removed through the tenant user API.
  if (currentRole === 'SuperAdmin') return 'protected';
  // A tenant must keep at least one TenantAdmin, or nobody could manage it.
  if (currentRole === 'TenantAdmin' && newRole !== 'TenantAdmin' && otherAdmins === 0) return 'last_admin';
  return 'ok';
}
