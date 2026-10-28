'use client';

import type { Role } from '@repo/shared-types';
import { Bell, Building2, FileText, KeyRound, LayoutDashboard, ScrollText, Settings, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'cn';

// `roles`: only shown to these (the API enforces the same; this just hides links that would 404).
// `capability`: only while that optional module is installed and enabled for the tenant.
const LINKS: { href: string; label: string; icon: typeof Settings; roles?: Role[]; capability?: string }[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/tenants', label: 'Tenants', icon: Building2, roles: ['SuperAdmin'] },
  { href: '/users', label: 'Users', icon: Users, roles: ['SuperAdmin', 'TenantAdmin', 'Auditor'] },
  { href: '/api-keys', label: 'API keys', icon: KeyRound, roles: ['TenantAdmin', 'Auditor'] },
  { href: '/files', label: 'Files', icon: FileText, roles: ['TenantAdmin', 'User', 'Auditor'], capability: 'storage' },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/audit', label: 'Audit log', icon: ScrollText, roles: ['SuperAdmin', 'TenantAdmin', 'Auditor'] },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/account', label: 'Account', icon: UserRound },
];

export function SidebarNav({ role, features }: { role: Role; features: string[] }) {
  const pathname = usePathname();
  const visible = LINKS.filter((l) => (!l.roles || l.roles.includes(role)) && (!l.capability || features.includes(l.capability)));
  return (
    <nav aria-label="Main" className="px-3 pb-4">
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
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
