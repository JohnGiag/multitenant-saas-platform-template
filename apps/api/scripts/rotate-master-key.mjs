// Re-encrypts every sealed secret (BYOK integrations, webhook signing secrets) from one BYOK_MASTER_KEY to another, in
// one transaction: all of them or none. Stop every API instance first, since each holds the key it started with:
//   BYOK_MASTER_KEY=<current> BYOK_MASTER_KEY_NEW=<new> pnpm --filter @repo/api db:rotate-master-key
// then start them again with BYOK_MASTER_KEY=<new>. A secret already sealed with the new key is left as it is, so running
// it twice is harmless. Tenant ids as arguments limit it to those tenants (the tests do). Never prints a secret.
// Reads apps/api/.env for DATABASE_URL. Needs `pnpm build` first (it uses the built Prisma client and secret box).
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';

if (existsSync('.env')) process.loadEnvFile();
const { PrismaClient } = await import(new URL('../dist/generated/prisma/client.js', import.meta.url).href);
const { openSecret, parseMasterKey, sealSecret } = await import(new URL('../dist/modules/integrations/domain/secret-box.js', import.meta.url).href);

// Every sealed column, with the context the module that seals it binds it to. A module that seals another adds it here.
const SEALED = [
  { model: 'tenantIntegration', column: 'encryptedConfig', context: (row) => `${row.tenantId}/${row.provider}`, select: { provider: true } },
  { model: 'webhookEndpoint', column: 'encryptedSecret', context: (row) => `${row.tenantId}/webhooks` },
];

if (!process.env.BYOK_MASTER_KEY_NEW) throw new Error('Set BYOK_MASTER_KEY (the current key) and BYOK_MASTER_KEY_NEW');
const current = parseMasterKey(process.env.BYOK_MASTER_KEY ?? '');
const next = parseMasterKey(process.env.BYOK_MASTER_KEY_NEW);
if (Buffer.compare(current, next) === 0) throw new Error('BYOK_MASTER_KEY_NEW is the current key');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const counts = { resealed: 0, alreadyNew: 0 };
try {
  await db.$transaction(
    async (tx) => {
      const only = process.argv.slice(2);
      const tenants = only.length ? only : (await tx.tenant.findMany({ select: { id: true } })).map((tenant) => tenant.id);
      // Tenant by tenant, as every query on tenant-owned rows is.
      for (const tenantId of tenants) {
        for (const { model, column, context, select } of SEALED) {
          for (const row of await tx[model].findMany({ where: { tenantId }, select: { id: true, tenantId: true, [column]: true, ...select } })) {
            const bound = context(row);
            let plaintext;
            try {
              plaintext = openSecret(current, row[column], bound);
            } catch {
              try {
                openSecret(next, row[column], bound);
              } catch {
                throw new Error(`${model} ${row.id} opens with neither key: nothing was changed`);
              }
              counts.alreadyNew++;
              continue;
            }
            await tx[model].updateMany({ where: { id: row.id, tenantId }, data: { [column]: sealSecret(next, plaintext, bound) } });
            counts.resealed++;
          }
        }
      }
    },
    { timeout: 10 * 60_000 },
  );
  console.log(`Re-sealed ${counts.resealed} secrets with the new key; ${counts.alreadyNew} had it already. Start the API with BYOK_MASTER_KEY set to the new key.`);
} finally {
  await db.$disconnect();
}
