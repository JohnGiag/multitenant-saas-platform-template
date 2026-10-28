import { defineConfig, devices } from '@playwright/test';

// The dashboard against the real API, Postgres and Redis (docker compose up), in local auth mode whatever the
// .env files say: Clerk mode needs a live Clerk instance. Own ports, so dev servers on 3000/3001 can keep running.
const API_PORT = 3100;
const WEB_PORT = 3101;

export default defineConfig({
  testDir: './e2e',
  // One run's tenants and accounts (scripts/e2e-fixtures.mjs in apps/api), removed afterwards.
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [
    // Signs each role in once and saves its session for the other tests.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
  ],
  webServer: [
    {
      // The built API (pnpm build), reading apps/api/.env; these variables take precedence over it.
      command: 'node dist/main.js',
      cwd: '../api',
      url: `http://localhost:${API_PORT}/v1/auth/me`,
      env: { PORT: String(API_PORT), AUTH_PROVIDER: 'local' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Built here, in local mode: AUTH_PROVIDER and NEXT_PUBLIC_* are baked in at build time.
      command: `pnpm exec next build && pnpm exec next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      env: {
        AUTH_PROVIDER: 'local',
        API_URL: `http://localhost:${API_PORT}`,
        TRUST_PROXY_HOPS: '0',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '',
        CLERK_SECRET_KEY: '',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
