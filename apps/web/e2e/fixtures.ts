import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// Written by global-setup (gitignored): this run's seeded tenants and accounts, and each role's saved session.
export const AUTH_DIR = join(import.meta.dirname, '.auth');
const FIXTURES_FILE = join(AUTH_DIR, 'fixtures.json');
const API_DIR = join(import.meta.dirname, '../../api');

type Tenant = { id: string; name: string };
export interface Fixtures {
  password: string;
  tenants: { platform: Tenant; acme: Tenant; beta: Tenant };
  emails: Record<'super' | 'admin' | 'member' | 'auditor' | 'multi', string>;
}
export type Role = 'super' | 'admin' | 'auditor';

export const sessionFile = (role: Role) => join(AUTH_DIR, `${role}.json`);

export function seedFixtures(runId: string): Fixtures {
  const out = execFileSync('node', ['scripts/e2e-fixtures.mjs', 'seed', runId], { cwd: API_DIR, encoding: 'utf8' });
  const fixtures = JSON.parse(out) as Fixtures;
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures));
  return fixtures;
}

export function removeFixtures(): void {
  const { tenants } = fixtures();
  execFileSync('node', ['scripts/e2e-fixtures.mjs', 'cleanup', ...Object.values(tenants).map((t) => t.id)], { cwd: API_DIR });
}

export const fixtures = (): Fixtures => JSON.parse(readFileSync(FIXTURES_FILE, 'utf8')) as Fixtures;

export async function signIn(page: Page, email: string, password = fixtures().password): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// WCAG 2.0, 2.1 and 2.2, levels A and AA (CLAUDE.md). One line per violation, so a failure reads as a list.
export async function expectAccessible(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(violations.map((v) => `${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}
