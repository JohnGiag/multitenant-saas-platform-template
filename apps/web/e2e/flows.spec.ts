import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, fixtures, sessionFile } from './fixtures';

async function createApiKey(page: Page, name: string): Promise<string> {
  await page.goto('/api-keys');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create key' }).click();
  // Filtered: Next.js's route announcer is a role="alert" on every page too.
  await expect(page.getByRole('alert').filter({ hasText: `Key “${name}” created` })).toBeVisible();
  return page.getByLabel('Your new API key').inputValue();
}

test.describe('TenantAdmin', () => {
  test.use({ storageState: sessionFile('admin') });

  test("changes a member's role", async ({ page }) => {
    const { member } = fixtures().emails;
    await page.goto('/users');
    const row = page.getByRole('row').filter({ hasText: member });
    await row.getByRole('combobox', { name: `Role of ${member}` }).click();
    await page.getByRole('option', { name: 'Auditor' }).click();
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Role changed.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('combobox', { name: `Role of ${member}` })).toHaveText('Auditor');
  });

  test('creates an API key that is shown once, then revokes it', async ({ page }) => {
    const name = `e2e-key-${Date.now()}`;
    const key = await createApiKey(page, name);
    expect(key).toMatch(/^eak_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    // The alert with the key is part of the page too.
    await expectAccessible(page);

    // Never again: after a reload only its name and prefix are listed.
    await page.reload();
    expect(await page.content()).not.toContain(key);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row.getByText('Active')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(row.getByText('Revoked')).toBeVisible();
  });

  test('filters the audit log by actor', async ({ page }) => {
    await createApiKey(page, `e2e-audit-${Date.now()}`);
    await page.goto('/audit');
    const first = page.getByRole('row').nth(1);
    await expect(first).toContainText('POST /v1/api-keys');

    // Every actor ID links to the log filtered by that actor.
    await first.getByRole('link', { name: /^Show only actions by / }).click();
    await expect(page).toHaveURL(/actorId=/);
    const actorId = new URL(page.url()).searchParams.get('actorId')!;
    await expect(page.getByLabel('Actor ID')).toHaveValue(actorId);
    const actors = page.getByRole('link', { name: /^Show only actions by / });
    await expect(actors.first()).toBeVisible();
    for (const link of await actors.all()) await expect(link).toHaveText(actorId);

    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.getByLabel('Actor ID')).toHaveValue('');
  });

  test('saves an integration; only masked values come back', async ({ page }) => {
    const secret = `re_e2e_${Date.now()}_secret`;
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Email' }).click();
    await page.getByLabel('API key').fill(secret);
    await page.getByLabel('Sender').fill('E2E <e2e@example.com>');
    await page.getByRole('tabpanel').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('tabpanel').getByText('Saved.')).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: 'Email' }).click();
    await expect(page.getByRole('tabpanel').getByText(`****${secret.slice(-4)}`)).toBeVisible();
    expect(await page.content()).not.toContain(secret);
  });
});

test.describe('Webhooks', () => {
  test.describe('TenantAdmin', () => {
    test.use({ storageState: sessionFile('admin') });

    test('adds an endpoint for chosen events, sees its secret once, then turns it off and removes it', async ({ page }) => {
      const url = `https://hooks.example.com/e2e-${Date.now()}`;
      await page.goto('/');
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Webhooks' }).click();
      await page.getByLabel('Endpoint URL').fill(url);
      await page.getByRole('checkbox', { name: 'member.joined' }).click();
      await page.getByRole('button', { name: 'Add endpoint' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Shown only now' })).toBeVisible();
      await expect(page.getByLabel('Signing secret')).toHaveValue(/^whsec_/);

      const row = page.getByRole('row').filter({ hasText: url });
      await expect(row.getByText('member.joined')).toBeVisible();
      await row.getByRole('button', { name: 'Turn off' }).click();
      await expect(row.getByText('Off', { exact: true })).toBeVisible();
      page.once('dialog', (dialog) => void dialog.accept());
      await row.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('row').filter({ hasText: url })).toHaveCount(0);
    });
  });

  test.describe('Auditor', () => {
    test.use({ storageState: sessionFile('auditor') });

    test('reads the endpoints but cannot add or change them', async ({ page }) => {
      await page.goto('/webhooks');
      await expect(page.getByRole('heading', { level: 2, name: 'Endpoints' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Add endpoint|Delete|Turn off|Rotate/ })).toHaveCount(0);
    });
  });
});

test.describe('Billing', () => {
  test.describe('TenantAdmin', () => {
    test.use({ storageState: sessionFile('admin') });

    test('sees the free plan and the plans to choose from, reached from the sidebar', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Billing' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Billing' })).toBeVisible();
      await expect(page.getByText('No subscription yet')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Upgrade to Enterprise' })).toBeVisible();
    });

    // This tenant never started a checkout, so the API cannot confirm the session: the page falls back to waiting.
    test('back from a checkout it cannot confirm, says the plan follows once Stripe confirms', async ({ page }) => {
      await page.goto('/billing?checkout_session=cs_test_e2e');
      await expect(page.getByRole('status').filter({ hasText: 'Payment received' })).toBeVisible();
    });
  });

  test.describe('Auditor', () => {
    test.use({ storageState: sessionFile('auditor') });

    test('reads the plan but cannot change it', async ({ page }) => {
      await page.goto('/billing');
      await expect(page.getByRole('heading', { level: 2, name: 'Current plan' })).toBeVisible();
      await expect(page.getByText('Only TenantAdmins can change the subscription.')).toBeVisible();
      await expect(page.getByRole('button', { name: /Upgrade|portal/ })).toHaveCount(0);
    });
  });

  test.describe('SuperAdmin', () => {
    test.use({ storageState: sessionFile('super') });

    test('has no billing page, and cannot set tiers while billing is on', async ({ page }) => {
      expect((await page.goto('/billing'))?.status()).toBe(404);
      await page.goto('/tenants');
      await page.locator('summary').first().click();
      await expect(page.getByText('follows its subscription (billing)').first()).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Tier' })).toHaveCount(0);
    });
  });
});

test.describe('Auditor', () => {
  test.use({ storageState: sessionFile('auditor') });

  test('reads but cannot change anything', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { level: 2, name: 'Members' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send invitation' })).toHaveCount(0);
    await page.goto('/api-keys');
    await expect(page.getByRole('button', { name: 'Create key' })).toHaveCount(0);
  });
});

test.describe('SuperAdmin', () => {
  test.use({ storageState: sessionFile('super') });

  test('switches to another tenant and manages its users', async ({ page }) => {
    const { tenants, emails } = fixtures();
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Tenant' }).click();
    await page.getByRole('option', { name: tenants.acme.name }).click();
    await expect(page.getByRole('heading', { level: 2, name: tenants.acme.name })).toBeVisible();

    await page.goto('/users');
    await expect(page.getByRole('row').filter({ hasText: emails.admin })).toBeVisible();
  });
});
