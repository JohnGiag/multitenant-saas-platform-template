'use client';

import type { Role } from '@repo/shared-types';
import { Bell, Building2, CreditCard, FileText, KeyRound, LayoutDashboard, ScrollText, Settings, UserRound, Users, Webhook } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'cn';
import { useT } from '@/components/i18n-provider';

// `roles`: only shown to these (the API enforces the same; this just hides links that would 404).
// `capability`: only while that optional module is installed and enabled for the tenant. `label` is a message key.
// `live`: not in test mode, where a tenant has no members or plan of its own.
const LINKS: { href: string; label: string; icon: typeof Settings; roles?: Role[]; capability?: string; live?: boolean }[] = [
  { href: '/', label: 'nav.overview', icon: LayoutDashboard },
  { href: '/tenants', label: 'nav.tenants', icon: Building2, roles: ['SuperAdmin'] },
  { href: '/users', label: 'nav.users', icon: Users, roles: ['SuperAdmin', 'TenantAdmin', 'Auditor'], live: true },
  { href: '/api-keys', label: 'nav.apiKeys', icon: KeyRound, roles: ['TenantAdmin', 'Auditor'] },
  { href: '/files', label: 'nav.files', icon: FileText, roles: ['TenantAdmin', 'User', 'Auditor'], capability: 'storage' },
  { href: '/billing', label: 'nav.billing', icon: CreditCard, roles: ['TenantAdmin', 'Auditor'], capability: 'billing', live: true },
  { href: '/webhooks', label: 'nav.webhooks', icon: Webhook, roles: ['TenantAdmin', 'Auditor'], capability: 'webhooks' },
  { href: '/notifications', label: 'nav.notifications', icon: Bell },
  { href: '/audit', label: 'nav.audit', icon: ScrollText, roles: ['SuperAdmin', 'TenantAdmin', 'Auditor'] },
  { href: '/settings', label: 'nav.settings', icon: Settings },
  { href: '/account', label: 'nav.account', icon: UserRound },
];

export function SidebarNav({ role, features, testMode }: { role: Role; features: string[]; testMode: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const visible = LINKS.filter((l) => (!l.roles || l.roles.includes(role)) && (!l.capability || features.includes(l.capability)) && !(testMode && l.live));
  return (
    <nav aria-label={t('nav.main')} className="px-3 pb-4">
      <ul className="flex flex-wrap gap-1 md:flex-col">
        {visible.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring',
                  active && 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground hover:text-sidebar-accent-foreground',
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {t(label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
