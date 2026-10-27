import type { CursorPage } from '@repo/shared-types';
import { z } from 'zod';
import { toCursorPage } from './cursor-page.js';

// Keyset ("seek") pagination over (field, id), for sort fields that are not unique (e.g. created_at):
// the id breaks ties, so the order is total and stable. No OFFSET, so deep pages cost the same as page 1.
// The cursor is opaque to clients: base64url JSON of the last row's [field value, id].
export interface KeysetCursor {
  value: string | number;
  id: string;
}

type CursorValueSchema = z.ZodType<string | number>;

// `value` is the sort field's type (e.g. z.iso.datetime() for created_at): the cursor comes from the
// client, so a value of the wrong type must be rejected here rather than reach the database.
export function decodeKeysetCursor(cursor: string, value: CursorValueSchema): KeysetCursor | null {
  try {
    const parsed = z.tuple([value, z.uuid()]).safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return parsed.success ? { value: parsed.data[0], id: parsed.data[1] } : null;
  } catch {
    return null;
  }
}

// For query validation: turns the opaque string into a KeysetCursor, or fails with 400.
export const keysetCursorSchema = (value: CursorValueSchema) =>
  z
    .string()
    .max(512)
    .transform(
      (cursor, ctx) =>
        decodeKeysetCursor(cursor, value) ?? (ctx.addIssue({ code: 'custom', message: 'Invalid cursor' }), z.NEVER),
    );

// Prisma `where`/`orderBy` for the page after `cursor`. Combine `where` with the tenant filter, and back
// it with an index on (tenant_id, field, id). The redundant `field >=/<= value` bound lets Postgres seek
// straight to the cursor in that index instead of scanning from the start and filtering.
export function keysetArgs(field: string, direction: 'asc' | 'desc', cursor?: KeysetCursor) {
  const [strict, inclusive] = direction === 'asc' ? ['gt', 'gte'] : ['lt', 'lte'];
  const where = cursor
    ? {
        AND: [
          { [field]: { [inclusive]: cursor.value } },
          { OR: [{ [field]: { [strict]: cursor.value } }, { id: { [strict]: cursor.id } }] },
        ],
      }
    : {};
  return { where, orderBy: [{ [field]: direction }, { id: direction }] };
}

// Expects `limit + 1` rows, like toCursorPage.
export function keysetPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  valueOf: (row: T) => string | number,
): CursorPage<T> {
  return toCursorPage(rows, limit, (row) => Buffer.from(JSON.stringify([valueOf(row), row.id])).toString('base64url'));
}
