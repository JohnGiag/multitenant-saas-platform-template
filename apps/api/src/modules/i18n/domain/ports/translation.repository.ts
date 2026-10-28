import type { Locale } from '@repo/shared-types';

export const TRANSLATION_REPOSITORY = Symbol('TranslationRepository');

export interface TranslationRepository {
  // Key to text in `locale`, with English for the keys it lacks.
  messages(locale: Locale): Promise<Record<string, string>>;
}
