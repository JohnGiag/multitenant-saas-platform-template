import { expect, test as setup } from '@playwright/test';
import { fixtures, sessionFile, signIn, type Role } from './fixtures';

// One sign-in per role, saved for the other tests (sessions last 15 minutes, longer than a run).
for (const role of ['super', 'admin', 'auditor'] as Role[]) {
  setup(`sign in as ${role}`, async ({ page }) => {
    await signIn(page, fixtures().emails[role]);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await page.context().storageState({ path: sessionFile(role) });
  });
}
