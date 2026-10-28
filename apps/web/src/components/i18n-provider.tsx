'use client';

import { DEFAULT_LOCALE, type Locale } from '@repo/shared-types';
import { createContext, use, useMemo, type ReactNode } from 'react';
import { translator, type Messages, type Translate } from '@/lib/translate';

const I18nContext = createContext<{ locale: Locale; messages: Messages }>({ locale: DEFAULT_LOCALE, messages: {} });

// The root layout hands the text it loaded on the server to client components.
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useT(): Translate {
  const { messages } = use(I18nContext);
  return useMemo(() => translator(messages), [messages]);
}

export const useLocale = (): Locale => use(I18nContext).locale;
