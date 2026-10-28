import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import type { CursorPage, Tenant } from '@repo/shared-types';
import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { LanguageSwitcher } from '@/components/language-switcher';
import { SidebarNav } from '@/components/sidebar-nav';
import { TenantSwitcher } from '@/components/tenant-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, getCapabilities, getCurrentTenant, getPrincipal } from '@/lib/api';
import { CLERK } from '@/lib/auth-mode';
import { getT } from '@/lib/i18n';
import { getTenantOverride } from '@/lib/session';
import { signOut } from '../(auth)/actions';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const [me, t] = await Promise.all([getPrincipal(), getT()]);
  // Capability-gated links are tenant features, which SuperAdmin never gets; skipping the call also keeps the
  // layout working if its selected tenant was deleted.
  const features = me.role === 'SuperAdmin' ? [] : (await getCapabilities()).filter((c) => c.enabled).map((c) => c.key);
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only rounded-md bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-[3px] focus:ring-ring"
      >
        {t('common.skipToContent')}
      </a>
      <aside className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:overflow-y-auto md:border-r md:border-b-0">
        <Brand className="px-6 py-5" />
        <SidebarNav role={me.role} features={features} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-16 flex-wrap items-center justify-between gap-4 border-b bg-background/85 px-4 py-3 backdrop-blur sm:px-6 lg:px-10">
          {/* A SuperAdmin picks tenants with X-Tenant-Id; in Clerk mode everyone else switches the active organization. */}
          {me.role === 'SuperAdmin' ? (
            <SuperAdminTenants ownTenantId={me.tenantId} />
          ) : CLERK ? (
            <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/signed-in" />
          ) : (
            <CurrentTenant />
          )}
          <div className="flex items-center gap-3">
            <Badge variant="secondary">{me.role}</Badge>
            <LanguageSwitcher />
            <ThemeToggle />
            {/* Clerk's account menu: profile, password, sessions, sign out. */}
            {CLERK ? (
              <UserButton />
            ) : (
              <form action={signOut}>
                <Button type="submit" variant="outline" size="sm">
                  {t('common.signOut')}
                </Button>
              </form>
            )}
          </div>
        </header>
        {/* *:mx-auto: each page's column sits centred in the space beside the sidebar. */}
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-8 outline-none *:mx-auto *:w-full sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}

// shortcut: lists the first 100 tenants only; the Tenants page pages through all of them and can open any.
async function SuperAdminTenants({ ownTenantId }: { ownTenantId: string }) {
  const [{ items }, selected] = await Promise.all([api<CursorPage<Tenant>>('/tenants?limit=100', { ownTenant: true }), getTenantOverride()]);
  return <TenantSwitcher tenants={items.map(({ id, name }) => ({ id, name }))} current={selected ?? ownTenantId} ownTenantId={ownTenantId} />;
}

async function CurrentTenant() {
  const [tenant, t] = await Promise.all([getCurrentTenant(), getT()]);
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{t('layout.tenant')} </span>
      <span className="font-medium">{tenant.name}</span>
    </p>
  );
}
