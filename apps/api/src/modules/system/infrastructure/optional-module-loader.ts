import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IntegrationProviderSchema } from '@repo/shared-types';
import { z } from 'zod';
import type { OptionalModule } from '../domain/optional-module.js';

// Compiled location of src/optional/ (this file lives in modules/system/infrastructure/).
const DEFAULT_DIR = fileURLToPath(new URL('../../../optional/', import.meta.url));

const DescriptorSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,64}$/),
  integration: IntegrationProviderSchema.optional(),
  module: z.custom<OptionalModule['module']>((value) => typeof value === 'function'),
});

// Imports every <dir>/<name>/index.js. A missing folder means "not installed"; a broken one
// (no index.js, bad export, duplicate key) stops startup rather than silently disappearing.
export async function loadOptionalModules(dir = DEFAULT_DIR): Promise<OptionalModule[]> {
  if (!existsSync(dir)) return [];
  const modules: OptionalModule[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryFile = join(dir, entry.name, 'index.js');
    if (!existsSync(entryFile)) throw new Error(`Optional module "${entry.name}" has no index.js`);

    const { default: descriptor } = await import(pathToFileURL(entryFile).href);
    const parsed = DescriptorSchema.safeParse(descriptor);
    if (!parsed.success) {
      throw new Error(`Optional module "${entry.name}" has an invalid default export: ${parsed.error.message}`);
    }
    if (modules.some((m) => m.key === parsed.data.key)) {
      throw new Error(`Optional module key "${parsed.data.key}" is declared twice`);
    }
    modules.push(parsed.data);
  }
  return modules;
}
