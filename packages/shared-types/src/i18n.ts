import { z } from 'zod';

// The dashboard's languages. Adding one: list it here and insert its rows into `translations` (a migration).
export const LOCALES = ['en', 'el'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;
// Every key exists in it; other languages fall back to it key by key.
export const DEFAULT_LOCALE: Locale = 'en';

export const TranslationsSchema = z.object({
  locale: LocaleSchema,
  // Key to text; `{name}` marks a value filled in by the dashboard.
  messages: z.record(z.string(), z.string()),
});
export type Translations = z.infer<typeof TranslationsSchema>;
