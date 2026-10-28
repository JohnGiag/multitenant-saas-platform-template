'use client';

import { LOCALES } from '@repo/shared-types';
import { useTransition } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { setLocale } from '@/app/actions';
import { useLocale, useT } from './i18n-provider';

// Each language named in itself (English, Ελληνικά), so a reader finds theirs whatever the page is in.
const NAMES = Object.fromEntries(LOCALES.map((l) => [l, new Intl.DisplayNames([l], { type: 'language' }).of(l)]));

export function LanguageSwitcher() {
  const t = useT();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Select value={locale} disabled={pending} onValueChange={(l) => startTransition(() => setLocale(l))}>
        <SelectTrigger aria-label={t('common.language')} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((l) => (
            <SelectItem key={l} value={l} lang={l}>
              {NAMES[l]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span aria-live="polite" className="sr-only">
        {pending ? t('common.changingLanguage') : ''}
      </span>
    </>
  );
}
