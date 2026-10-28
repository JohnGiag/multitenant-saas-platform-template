import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// The dashboard's text lives in the API's `translations` table, seeded by migrations: a key typed wrong here would
// show as the raw key. Reads the migrations' INSERT rows, and every 'namespace.key' literal in this app's source.
const SRC = join(import.meta.dirname, '..');
const MIGRATIONS = join(import.meta.dirname, '../../../api/prisma/migrations');

function seededKeys(locale: string): Set<string> {
  const keys = new Set<string>();
  for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const sql = readFileSync(join(MIGRATIONS, dir.name, 'migration.sql'), 'utf8');
    for (const [, rowLocale, key] of sql.matchAll(/\('[0-9a-f-]{36}', '(\w+)', '([^']+)', /g)) if (rowLocale === locale) keys.add(key!);
  }
  return keys;
}

function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  for (const file of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(file) || file.endsWith('.test.ts') || file.includes('components/ui') || file.includes('components\\ui')) continue;
    for (const [, key] of readFileSync(join(SRC, file), 'utf8').matchAll(/'([a-z][a-zA-Z]*(?:\.[a-zA-Z0-9]+)+)'/g)) used.set(key!, file);
  }
  return used;
}

test('every message key the dashboard uses is seeded in English', () => {
  const english = seededKeys('en');
  const used = usedKeys();
  assert.ok(used.size > 100, 'found too few keys: did the source layout change?');
  assert.deepEqual([...used].filter(([key]) => !english.has(key)).map(([key, file]) => `${key} (${file})`), []);
});
