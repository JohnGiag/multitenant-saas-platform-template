import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  // Public: the OpenAPI document reads request schemas from the pipes (modules/system/presentation/api-docs.ts).
  constructor(readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map(({ path, message }) => ({ path, message })));
    }
    return result.data;
  }
}
