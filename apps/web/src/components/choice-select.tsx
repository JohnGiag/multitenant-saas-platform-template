import { AssignableRoleSchema, TenantTierSchema } from '@repo/shared-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ChoiceSelectProps {
  id?: string;
  // Accessible name when there is no visible <Label htmlFor={id}>.
  label?: string;
  defaultValue?: string;
}

// Submits `name` inside a form (Radix renders a hidden native <select>, so it works before JS loads too).
function ChoiceSelect({ name, options, id, label, defaultValue, optionLabels }: ChoiceSelectProps & { name: string; options: readonly string[]; optionLabels?: Record<string, string> }) {
  return (
    <Select name={name} defaultValue={defaultValue ?? options[0]}>
      <SelectTrigger id={id} aria-label={label} className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// SuperAdmin is never assignable through the tenant API.
export const RoleSelect = (props: ChoiceSelectProps) => <ChoiceSelect name="role" options={AssignableRoleSchema.options} defaultValue="User" {...props} />;

export const TierSelect = (props: ChoiceSelectProps) => <ChoiceSelect name="tier" options={TenantTierSchema.options} {...props} />;

export const OverrideSelect = (props: ChoiceSelectProps & { optionLabels: Record<string, string> }) => <ChoiceSelect name="override" options={['default', 'on', 'off']} {...props} />;
