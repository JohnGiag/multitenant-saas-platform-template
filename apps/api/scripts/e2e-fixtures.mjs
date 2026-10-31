// Tenants and accounts for the dashboard's end-to-end tests (apps/web/e2e), unique to one run:
//   node scripts/e2e-fixtures.mjs seed <runId>         prints the fixtures as JSON
//   node scripts/e2e-fixtures.mjs cleanup <tenantId>…  deletes those tenants and everything in them
// Run from apps/api (it reads .env there). Needs `pnpm build` first (it uses the built Prisma client).
import { existsSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to touch a production database');
if (existsSync('.env')) process.loadEnvFile();
const client = new URL('../dist/generated/prisma/client.js', import.meta.url);
if (!existsSync(client)) throw new Error('Run `pnpm build` first: this script uses the built Prisma client');
const { PrismaClient } = await import(client.href);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const PASSWORD = 'e2e correct horse battery staple';

async function seed(runId) {
  const passwordHash = await hash(PASSWORD);
  const email = (local) => `e2e-${runId}-${local}@example.com`;
  // Enterprise tier: a whole test run's page loads stay far below the per-user rate limit.
  const tenant = async (name, users) => {
    const { id } = await db.tenant.create({ data: { name: `${name} ${runId}`, tier: 'enterprise' } });
    await db.user.createMany({ data: users.map(([local, role]) => ({ tenantId: id, email: email(local), role, passwordHash })) });
    return { id, name: `${name} ${runId}` };
  };
  const platform = await tenant('E2E Platform', [['super', 'SuperAdmin']]);
  // `multi` has accounts in both tenants with the same password: sign-in asks which tenant.
  const acme = await tenant('E2E Acme', [['admin', 'TenantAdmin'], ['member', 'User'], ['auditor', 'Auditor'], ['multi', 'User']]);
  // betaadmin: the feature flag test turns webhooks off for Beta, so it cannot disturb Acme's webhook tests.
  const beta = await tenant('E2E Beta', [['multi', 'User'], ['betaadmin', 'TenantAdmin']]);
  return {
    password: PASSWORD,
    tenants: { platform, acme, beta },
    emails: Object.fromEntries(['super', 'admin', 'member', 'auditor', 'multi', 'betaadmin'].map((local) => [local, email(local)])),
  };
}

// What PrismaTenantRepository.delete removes, without its hooks: the tests leave no files or jobs behind.
async function cleanup(tenantIds) {
  const where = { tenantId: { in: tenantIds } };
  await db.$transaction([
    db.auditLog.deleteMany({ where }),
    db.tenantIntegration.deleteMany({ where }),
    db.tenantFeatureFlag.deleteMany({ where }),
    db.apiKey.deleteMany({ where }),
    db.invitation.deleteMany({ where }),
    db.user.deleteMany({ where }),
    db.tenant.deleteMany({ where: { id: { in: tenantIds } } }),
  ]);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'seed' && args[0]) console.log(JSON.stringify(await seed(args[0])));
  else if (command === 'cleanup' && args.length) await cleanup(args);
  else throw new Error('Usage: e2e-fixtures.mjs seed <runId> | cleanup <tenantId>…');
} finally {
  await db.$disconnect();
}
