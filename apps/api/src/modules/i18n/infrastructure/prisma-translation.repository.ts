import { Injectable } from '@nestjs/common';
import { DEFAULT_LOCALE, type Locale } from '@repo/shared-types';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import type { TranslationRepository } from '../domain/ports/translation.repository.js';

// Platform-wide text, not tenant-owned: no tenant filter.
@Injectable()
export class PrismaTranslationRepository implements TranslationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async messages(locale: Locale): Promise<Record<string, string>> {
    const rows = await this.prisma.translation.findMany({
      where: { locale: { in: [DEFAULT_LOCALE, locale] } },
      select: { locale: true, key: true, value: true },
    });
    // English first, so the requested language overwrites it key by key.
    const ordered = [...rows.filter((r) => r.locale === DEFAULT_LOCALE), ...rows.filter((r) => r.locale !== DEFAULT_LOCALE)];
    return Object.fromEntries(ordered.map((r) => [r.key, r.value]));
  }
}
