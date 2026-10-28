import { randomBytes } from 'node:crypto';
import { seedFixtures } from './fixtures';

// Unique emails per run: sign-in by email looks across tenants, so they must not match anything else in the database.
export default function globalSetup(): void {
  seedFixtures(randomBytes(4).toString('hex'));
}
