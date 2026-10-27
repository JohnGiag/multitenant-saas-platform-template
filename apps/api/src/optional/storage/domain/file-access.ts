import type { Role } from '@repo/shared-types';

// Who may delete a file: whoever uploaded it (a user or an API key), or a TenantAdmin.
export function mayDeleteFile(caller: { id: string; role: Role }, uploaderId: string): boolean {
  return caller.role === 'TenantAdmin' || caller.id === uploaderId;
}
