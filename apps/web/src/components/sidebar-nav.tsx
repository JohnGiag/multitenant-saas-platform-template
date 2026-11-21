'use client';

import type { Role } from '@repo/shared-types';
import { Bell, Building2, CreditCard, FileText, Gauge, KeyRound, LayoutDashboard, Menu, ScrollText, Search, Settings, UserRound, Users, Webhook, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { cn } from 'cn';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// `roles`: only shown to these (the API enforces the same; this just hides links that would 404).
// `capability`: only while that optional module is installed and enabled for the tenant. `label` is a message key.
// `live`: not in test mode, where a tenant has no members or plan of its own.
type NavLink = { href: string; label: string; icon: typeof Settings; roles?: Role[]; capability?: string; live?: boolean };

// In this order. `label` names a group (a message key); the first has none. A module's pages join the group they fit.
const GROUPS: { label?: string; links: NavLink[] }[] = [
  {
    links: [
      { href: '/', label: 'nav.overview', icon: LayoutDashboard },
      { href: '/tenants', label: 'nav.tenants', icon: Building2, roles: ['SuperAdmin'] },
    ],
  },
  {
    label: 'nav.group.developers',
    links: [
      { href: '/api-keys', label: 'nav.apiKeys', icon: KeyRound, roles: ['TenantAdmin', 'Auditor'] },
      { href: '/webhooks', label: 'nav.webhooks', icon: Webhook, roles: ['TenantAdmin', 'Auditor'], capability: 'webhooks' },
    ],
  },
  {
    label: 'nav.group.organization',
    links: [
      { href: '/users', label: 'nav.users', icon: Users, roles: ['SuperAdmin', 'TenantAdmin', 'Auditor'], live: true },
      { href: '/files', label: 'nav.files', icon: FileText, roles: ['TenantAdmin', 'User', 'Auditor'], capability: 'storage' },
      { href: '/billing', label: 'nav.billing', icon: CreditCard, roles: ['TenantAdmin', 'Auditor'], capability: 'billing', live: true },
      { href: '/usage', label: 'nav.usage', icon: Gauge, roles: ['TenantAdmin', 'Auditor'], capability: 'usage' },
      { href: '/audit', label: 'nav.audit', icon: ScrollText, roles: ['SuperAdmin', 'TenantAdmin', 'Auditor'] },
      { href: '/settings', label: 'nav.settings', icon: Settings },
    ],
  },
  {
    label: 'nav.group.you',
    links: [
      { href: '/notifications', label: 'nav.notifications', icon: Bell },
      { href: '/account', label: 'nav.account', icon: UserRound },
    ],
  },
];

// Case and accents aside, so "λογαριασμος" finds "Λογαριασμός".
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function SidebarNav({ role, features, testMode }: { role: Role; features: string[]; testMode: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  // Below `md` the links hide behind a menu button; from `md` up they always show and this changes nothing.
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  // Ctrl+K (⌘K on a Mac) from anywhere on the page: the menu opens first, or its search could not take focus.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        flushSync(() => setOpen(true));
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  // Escape closes an open menu and gives its button the focus back.
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  // Leaving for a page: the search is done with, and the menu too.
  const leave = () => {
    setQuery('');
    setOpen(false);
  };

  const allowed = (link: NavLink) => (!link.roles || link.roles.includes(role)) && (!link.capability || features.includes(link.capability)) && !(testMode && link.live);
  const words = fold(query.trim());
  // A group's name finds its pages too: "developers" lists API keys and webhooks.
  const found = (link: NavLink, group?: string) => !words || fold(`${t(link.label)} ${group ? t(group) : ''}`).includes(words);
  const groups = GROUPS.map(({ label, links }) => ({ label, links: links.filter((link) => allowed(link) && found(link, label)) })).filter((group) => group.links.length > 0);
  const matches = groups.flatMap((group) => group.links);

  return (
    <>
      {/* In the brand's row: the aside positions it. */}
      <Button
        ref={toggle}
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 md:hidden"
        aria-expanded={open}
        aria-controls="main-nav"
        aria-label={t(open ? 'nav.closeMenu' : 'nav.openMenu')}
        onClick={() => setOpen(!open)}
      >
        {open ? <X aria-hidden /> : <Menu aria-hidden />}
      </Button>
      <nav
        id="main-nav"
        aria-label={t('nav.main')}
        className={cn(
          'px-3 pb-4 md:block',
          // Open on a phone: over the page, under the bar, scrolling on its own.
          open
            ? 'max-md:absolute max-md:inset-x-0 max-md:top-full max-md:max-h-[calc(100dvh-5rem)] max-md:overflow-y-auto max-md:border-b max-md:border-sidebar-border max-md:bg-sidebar max-md:pt-1 max-md:shadow-lg'
            : 'hidden',
        )}
      >
        <form
          role="search"
          className="mb-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!words || !matches[0]) return;
            leave();
            router.push(matches[0].href);
          }}
        >
          <label htmlFor="nav-search" className="sr-only">
            {t('nav.search')}
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={search}
              id="nav-search"
              type="search"
              autoComplete="off"
              value={query}
              placeholder={t('nav.search')}
              aria-describedby="nav-search-hint"
              aria-keyshortcuts="Control+K Meta+K"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // A first Escape clears what was typed, a second one closes the menu.
                if (event.key !== 'Escape' || !query) return;
                event.stopPropagation();
                setQuery('');
              }}
              className="bg-background pr-14 pl-8"
            />
            <kbd aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1.5 font-sans text-[11px] text-muted-foreground">
              Ctrl K
            </kbd>
          </div>
          <p id="nav-search-hint" className="sr-only">
            {t('nav.searchHint')}
          </p>
          <p role="status" className="sr-only">
            {words ? t('nav.searchFound', { count: matches.length }) : ''}
          </p>
        </form>

        {groups.map(({ label, links }, index) => (
          <div key={label ?? 'top'} className={cn(index > 0 && 'mt-4')}>
            {label && (
              <p id={`nav-${label}`} className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t(label)}
              </p>
            )}
            <ul aria-labelledby={label && `nav-${label}`} className="flex flex-col gap-1">
              {links.map(({ href, label: name, icon: Icon }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={leave}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring',
                        active && 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground hover:text-sidebar-accent-foreground',
                      )}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      {t(name)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {words && matches.length === 0 && <p className="px-3 text-sm text-muted-foreground">{t('nav.searchNone')}</p>}
      </nav>
    </>
  );
}
