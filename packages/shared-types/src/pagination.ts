import { z } from 'zod';

// Keyset pagination: `cursor` is the sort key of the last item of the previous page.
export const pageQuery = <C extends z.ZodType>(cursor: C) =>
  z.object({
    cursor: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

export const cursorPage = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
