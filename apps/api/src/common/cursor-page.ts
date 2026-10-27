import type { CursorPage } from '@repo/shared-types';

// Expects `limit + 1` rows: the extra row only signals that another page exists.
export function toCursorPage<T>(rows: T[], limit: number, cursorOf: (item: T) => string): CursorPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? cursorOf(last) : null };
}
