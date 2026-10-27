import { AssignableRoleSchema, type AssignableRole } from '@repo/shared-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Submits as `role` inside a form. SuperAdmin is never assignable through the tenant API.
export function RoleSelect({ id, label, defaultValue = 'User' }: { id?: string; label?: string; defaultValue?: AssignableRole }) {
  return (
    <Select name="role" defaultValue={defaultValue}>
      <SelectTrigger id={id} aria-label={label} className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AssignableRoleSchema.options.map((role) => (
          <SelectItem key={role} value={role}>
            {role}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
