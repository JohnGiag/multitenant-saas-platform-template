import { Controller, Get, Inject, Param } from '@nestjs/common';
import { LocaleSchema, TranslationsSchema, type Locale, type Translations } from '@repo/shared-types';
import { ApiDoc } from '../../../common/api-doc.js';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe.js';
import { Public } from '../../auth/presentation/decorators.js';
import { TRANSLATION_REPOSITORY, type TranslationRepository } from '../domain/ports/translation.repository.js';

@Controller('translations')
export class TranslationsController {
  constructor(@Inject(TRANSLATION_REPOSITORY) private readonly translations: TranslationRepository) {}

  // Public: the sign-in pages need their text before anyone is signed in.
  @Public()
  @ApiDoc("The dashboard's text in one language (English for keys it lacks)", TranslationsSchema)
  @Get(':locale')
  async get(@Param('locale', new ZodValidationPipe(LocaleSchema)) locale: Locale): Promise<Translations> {
    return { locale, messages: await this.translations.messages(locale) };
  }
}
