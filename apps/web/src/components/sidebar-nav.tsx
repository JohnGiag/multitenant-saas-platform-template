'use client';

import type { Role } from '@repo/shared-types';
import { LayoutDashboard, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from 'cn';

// `roles`: only shown to these (the API enforces the same; this just hides links that would 404).
const LINKS: { href: string; label: string; icon: typeof Settings; roles?: Role[] }[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/users', label: 'Users', icon: Users, roles: ['SuperAdmin', 'TenantAdmin', 'Auditor'] },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function SidebarNav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="px-3 pb-4">
      <ul className="flex gap-1 md:flex-col">
        {LINKS.filter((l) => !l.roles || l.roles.includes(role)).map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring',
                  active && 'bg-sidebar-accent font-medium',
                )}
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
