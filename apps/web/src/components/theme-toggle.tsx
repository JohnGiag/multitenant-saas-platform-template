'use client';

import { Moon, Sun } from 'lucide-react';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';

// Flips the theme set by THEME_SCRIPT and remembers the choice in this browser. CSS picks the icon, so the
// server render never has to know the theme.
export function ThemeToggle() {
  const t = useT();
  const toggle = () => {
    const dark = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // Storage blocked: the switch still applies to this page.
    }
  };
  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggle} aria-label={t('common.toggleDarkMode')}>
      <Sun aria-hidden className="dark:hidden" />
      <Moon aria-hidden className="hidden dark:block" />
    </Button>
  );
}
