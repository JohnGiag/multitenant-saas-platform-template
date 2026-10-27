import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { test } from 'node:test';

const SRC = resolve('src');
const sourceFiles = readdirSync(SRC, { recursive: true })
  .map((f) => join(SRC, f))
  .filter((f) => f.endsWith('.ts') && !f.includes(`${sep}generated${sep}`));

function importsOf(file) {
  return [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

// Domain code may import only the standard library, shared contracts and other domain files.
test('domain layers import no framework, ORM, vendor SDK or outer layer', () => {
  const files = sourceFiles.filter((f) => f.includes(`${sep}domain${sep}`));
  assert.ok(files.length > 0, 'no domain files found');

  for (const file of files) {
    const domainDir = file.slice(0, file.indexOf(`${sep}domain${sep}`) + `${sep}domain`.length);
    for (const spec of importsOf(file)) {
      const allowed =
        spec.startsWith('node:') ||
        spec === '@repo/shared-types' ||
        (spec.startsWith('.') && resolve(dirname(file), spec).startsWith(domainDir));
      assert.ok(allowed, `${file} imports "${spec}"`);
    }
  }
});

// Deleting any src/optional/<module> folder must never break compilation of anything else:
// only files inside that same folder may import from it (core and other optional modules may not).
test('optional modules are imported only from inside their own folder', () => {
  const optionalDir = join(SRC, 'optional') + sep;
  const moduleOf = (path) => (path.startsWith(optionalDir) ? path.slice(optionalDir.length).split(sep)[0] : null);
  for (const file of sourceFiles) {
    for (const spec of importsOf(file).filter((s) => s.startsWith('.'))) {
      const target = moduleOf(resolve(dirname(file), spec));
      assert.ok(target === null || target === moduleOf(file), `${file} imports "${spec}"`);
    }
  }
});
