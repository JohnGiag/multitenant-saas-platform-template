'use client';

import { useTransition } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { switchTenant } from '@/app/(dashboard)/actions';

interface TenantSwitcherProps {
  tenants: { id: string; name: string }[];
  current: string;
  ownTenantId: string;
}

// SuperAdmin only: picks the tenant its requests act on (X-Tenant-Id).
export function TenantSwitcher({ tenants, current, ownTenantId }: TenantSwitcherProps) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="tenant-switcher">Tenant</Label>
      <Select
        value={current}
        disabled={pending}
        onValueChange={(id) => startTransition(() => switchTenant(id === ownTenantId ? null : id))}
      >
        <SelectTrigger id="tenant-switcher" className="min-w-48">
          <SelectValue placeholder="Select a tenant" />
        </SelectTrigger>
        <SelectContent>
          {tenants.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
              {t.id === ownTenantId && ' (platform)'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span aria-live="polite" className="sr-only">
        {pending ? 'Switching tenant…' : ''}
      </span>
    </div>
  );
}
