import 'server-only';
import { LocaleSchema, type Locale, type Translations } from '@repo/shared-types';
import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { API_URL, TIMEOUT_MS } from './api';
import { negotiateLocale, translator, type Messages, type Translate } from './translate';

// Set by the language switcher; without it, the browser's preference.
export const LOCALE_COOKIE = 'locale';

export const getLocale = cache(async (): Promise<Locale> => {
  const chosen = LocaleSchema.safeParse((await cookies()).get(LOCALE_COOKIE)?.value);
  return chosen.success ? chosen.data : negotiateLocale((await headers()).get('accept-language'));
});

// The same for every visitor, so cached across requests (successful responses only): an edit to the
// `translations` table shows within a minute. No browser IP is forwarded: this is the dashboard's own call.
export const getMessages = cache(async (): Promise<Messages> => {
  const locale = await getLocale();
  const res = await fetch(`${API_URL}/v1/translations/${locale}`, {
    cache: 'force-cache',
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Could not load the ${locale} translations (${res.status})`);
  return ((await res.json()) as Translations).messages;
});

// For server components and server actions; client components use useT().
export const getT = cache(async (): Promise<Translate> => translator(await getMessages()));

// A page's title: `export const generateMetadata = pageTitle('nav.users');`
export const pageTitle = (key: string) => async (): Promise<Metadata> => ({ title: (await getT())(key) });
