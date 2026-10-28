import { Module } from '@nestjs/common';
import { TRANSLATION_REPOSITORY } from './domain/ports/translation.repository.js';
import { PrismaTranslationRepository } from './infrastructure/prisma-translation.repository.js';
import { TranslationsController } from './presentation/translations.controller.js';

// The dashboard's text, kept in the `translations` table so it can change without a deploy.
@Module({
  controllers: [TranslationsController],
  providers: [{ provide: TRANSLATION_REPOSITORY, useClass: PrismaTranslationRepository }],
})
export class I18nModule {}
