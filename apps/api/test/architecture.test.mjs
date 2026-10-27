import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';

// Domain code may import only the standard library, shared contracts and other domain files.
test('domain layers import no framework, ORM, vendor SDK or outer layer', () => {
  const modulesDir = resolve('src/modules');
  const files = readdirSync(modulesDir, { recursive: true })
    .map((f) => join(modulesDir, f))
    .filter((f) => f.endsWith('.ts') && f.includes(`${sep}domain${sep}`));
  assert.ok(files.length > 0, 'no domain files found');

  for (const file of files) {
    const domainDir = file.slice(0, file.indexOf(`${sep}domain${sep}`) + `${sep}domain`.length);
    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const allowed =
        spec.startsWith('node:') ||
        spec === '@repo/shared-types' ||
        (spec.startsWith('.') && resolve(dirname(file), spec).startsWith(domainDir));
      assert.ok(allowed, `${file} imports "${spec}"`);
    }
  }
});
