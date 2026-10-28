import { DEFAULT_LOCALE, LOCALES, type Locale } from '@repo/shared-types';

export type Messages = Record<string, string>;
export type Translate = (key: string, values?: Record<string, string | number>) => string;

// `{name}` takes values.name. A missing key shows as itself, so a gap is visible rather than blank.
export function translator(messages: Messages): Translate {
  return (key, values) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => (values && name in values ? String(values[name]) : match));
}

// The most preferred offered language in an Accept-Language header, e.g. "el-GR,el;q=0.9,en;q=0.8" gives "el".
export function negotiateLocale(header: string | null | undefined): Locale {
  const wanted = (header ?? '').split(',').map((part) => {
    const [tag = '', ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { lang: tag.split('-')[0]!.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 };
  });
  // Stable: equal weights keep the header's order.
  wanted.sort((a, b) => b.q - a.q);
  const match = wanted.find((w) => w.q > 0 && (LOCALES as readonly string[]).includes(w.lang));
  return (match?.lang as Locale | undefined) ?? DEFAULT_LOCALE;
}
