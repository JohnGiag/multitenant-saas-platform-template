// Local demo accounts, so the dashboard can be tried without inviting anyone by email:
//   pnpm --filter @repo/api db:seed-demo "<password, at least 12 characters>"
// Creates a "Platform" tenant with superadmin@example.com, and a "Demo Co" tenant with admin@, user@ and
// auditor@example.com, all with that password. Needs `pnpm build` first (it uses the built Prisma client).
// Running it again changes nothing.
import { existsSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';

const PLATFORM = 'Platform';
const DEMO = 'Demo Co';

// Known emails sharing one password: never in production.
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to create demo accounts with NODE_ENV=production');
const password = process.argv[2];
if (!password || password.length < 12) throw new Error('Pass a password of at least 12 characters');
if (existsSync('.env')) process.loadEnvFile();
const client = new URL('../dist/generated/prisma/client.js', import.meta.url);
if (!existsSync(client)) throw new Error('Run `pnpm build` first: this script uses the built Prisma client');
const { PrismaClient } = await import(client.href);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

try {
  if (await db.tenant.count({ where: { name: DEMO } })) {
    console.log('Demo accounts already exist (the password was not changed).');
  } else {
    const passwordHash = await hash(password);
    const create = async (name, users) => {
      const { id } = await db.tenant.create({ data: { name } });
      await db.user.createMany({ data: users.map(([email, role]) => ({ tenantId: id, email, passwordHash, role })) });
      return id;
    };
    await create(PLATFORM, [['superadmin@example.com', 'SuperAdmin']]);
    await create(DEMO, [
      ['admin@example.com', 'TenantAdmin'],
      ['user@example.com', 'User'],
      ['auditor@example.com', 'Auditor'],
    ]);
    console.log(`${PLATFORM}: superadmin@example.com (SuperAdmin)`);
    console.log(`${DEMO}: admin@example.com (TenantAdmin), user@example.com (User), auditor@example.com (Auditor)`);
  }
  console.log('Sign in at http://localhost:3001 with one of these emails and your password.');
} finally {
  await db.$disconnect();
}
