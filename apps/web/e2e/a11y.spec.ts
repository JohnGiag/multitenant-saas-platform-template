import { expect, test } from '@playwright/test';
import { expectAccessible, sessionFile, type Role } from './fixtures';

// Every page each role can open, checked against WCAG 2.2 AA with axe. Pages a role cannot open answer 404 and are
// covered by the role that can.
const PAGES: Record<Role, string[]> = {
  admin: ['/', '/users', '/api-keys', '/files', '/billing', '/billing?checkout_session=cs_test_e2e', '/webhooks', '/notifications', '/audit', '/settings', '/account'],
  auditor: ['/users', '/api-keys', '/audit', '/settings', '/billing', '/webhooks'],
  super: ['/tenants', '/users', '/audit'],
};

test.describe('signed out', () => {
  for (const path of ['/', '/login','/reset-password', '/reset-password?token=e2e', '/accept-invitation?token=e2e']) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectAccessible(page);
    });
  }
});

for (const [role, paths] of Object.entries(PAGES) as [Role, string[]][]) {
  test.describe(role, () => {
    test.use({ storageState: sessionFile(role) });
    for (const path of paths) {
      test(path, async ({ page }) => {
        const res = await page.goto(path);
        // Files exist only while the storage module is enabled (STORAGE_* set, or the tenant's own bucket).
        test.skip(path === '/files' && res?.status() === 404, 'storage module not enabled');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectAccessible(page);
      });
    }
  });
}
