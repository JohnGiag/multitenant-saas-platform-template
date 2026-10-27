import type { CursorPage, Tenant } from '@repo/shared-types';
import type { ReactNode } from 'react';
import { SidebarNav } from '@/components/sidebar-nav';
import { TenantSwitcher } from '@/components/tenant-switcher';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, getCurrentTenant, getPrincipal } from '@/lib/api';
import { getTenantOverride } from '@/lib/session';
import { signOut } from '../(auth)/actions';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getPrincipal();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only rounded-md bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-[3px] focus:ring-ring"
      >
        Skip to content
      </a>
      <aside className="border-b bg-sidebar text-sidebar-foreground md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <p className="px-6 py-4 font-semibold">Admin</p>
        <SidebarNav role={me.role} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-3">
          {me.role === 'SuperAdmin' ? <SuperAdminTenants ownTenantId={me.tenantId} /> : <CurrentTenant />}
          <div className="flex items-center gap-3">
            <Badge variant="secondary">{me.role}</Badge>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-6 outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}

// shortcut: lists the first 100 tenants only; switch to a searchable combobox over the cursor pages beyond that.
async function SuperAdminTenants({ ownTenantId }: { ownTenantId: string }) {
  const [{ items }, selected] = await Promise.all([api<CursorPage<Tenant>>('/tenants?limit=100', { ownTenant: true }), getTenantOverride()]);
  return <TenantSwitcher tenants={items.map(({ id, name }) => ({ id, name }))} current={selected ?? ownTenantId} ownTenantId={ownTenantId} />;
}

async function CurrentTenant() {
  const tenant = await getCurrentTenant();
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Tenant: </span>
      <span className="font-medium">{tenant.name}</span>
    </p>
  );
}
