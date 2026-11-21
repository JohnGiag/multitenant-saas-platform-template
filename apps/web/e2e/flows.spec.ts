import { expect, test, type Page } from '@playwright/test';
import { expectAccessible, fixtures, sessionFile, signIn } from './fixtures';

async function createApiKey(page: Page, name: string, open = true): Promise<string> {
  if (open) await page.goto('/api-keys');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create key' }).click();
  // Filtered: Next.js's route announcer is a role="alert" on every page too.
  await expect(page.getByRole('alert').filter({ hasText: `Key “${name}” created` })).toBeVisible();
  return page.getByLabel('Your new API key').inputValue();
}

test.describe('TenantAdmin', () => {
  test.use({ storageState: sessionFile('admin') });

  test('a refused form keeps what was typed, and a form that succeeded is cleared', async ({ page }) => {
    await page.goto('/account');
    await page.getByLabel('Current password').fill('not the right password');
    await page.getByLabel('New password').fill('a new password nobody will keep');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Current password is incorrect')).toBeVisible();
    await expect(page.getByLabel('Current password')).toHaveValue('not the right password');
    await expect(page.getByLabel('New password')).toHaveValue('a new password nobody will keep');

    await page.goto('/notifications');
    await page.getByLabel('Title').fill('E2E form reset');
    await page.getByLabel('Message').fill('Sent to myself');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByLabel('Title')).toHaveValue('');
    await expect(page.getByLabel('Message')).toHaveValue('');
  });

  test('the sidebar groups its pages, and its search takes you to one', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    const search = nav.getByRole('searchbox', { name: 'Search pages' });
    // A fork adds its pages to these groups: what is here must stay.
    for (const name of ['API keys', 'Webhooks']) await expect(nav.getByRole('list', { name: 'Developers' }).getByRole('link', { name })).toBeVisible();

    // From anywhere on the page, by keyboard alone: Ctrl+K, a word, Enter.
    await page.getByRole('main').click();
    await page.keyboard.press('Control+k');
    await expect(search).toBeFocused();
    await page.keyboard.type('AUDIT');
    await expect(nav.getByRole('link')).toHaveText(['Audit log']);
    await expect(nav.getByRole('status')).toHaveText('Pages found: 1');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/audit$/);
    await expect(search).toHaveValue('');

    // A group's name finds its pages; nothing found says so, and Escape brings every page back.
    await search.fill('developers');
    await expect(nav.getByRole('list')).toHaveCount(1);
    await expect(nav.getByRole('list', { name: 'Developers' })).toBeVisible();
    await search.fill('no such page');
    await expect(nav.getByText('No page matches.')).toBeVisible();
    await search.press('Escape');
    await expect(nav.getByRole('link', { name: 'Overview' })).toBeVisible();
  });

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
    expect(key).toMatch(/^sk_live_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
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

  test('a form resubmitted under the Idempotency-Key it was sent with is not applied twice', async ({ page }) => {
    const name = `e2e-once-${Date.now()}`;
    await page.goto('/api-keys');
    const field = page.locator('input[name="idempotencyKey"]');
    const sent = await field.inputValue();
    await createApiKey(page, name, false);
    await expect(field, 'a success brings the next key').not.toHaveValue(sent);

    // The same request under the key it was first sent with, as a resubmission after a lost response would be.
    await field.evaluate((input, key) => void ((input as HTMLInputElement).value = key), sent);
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create key' }).click();
    await expect(page.getByText('Already done, and its response was shown once')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1);
  });

  test('limits a key to the scopes ticked', async ({ page }) => {
    const name = `e2e-scoped-${Date.now()}`;
    await page.goto('/api-keys');
    await page.getByRole('checkbox', { name: 'write' }).click();
    await createApiKey(page, name, false);
    await expect(page.getByRole('row').filter({ hasText: name }).getByRole('cell', { name: 'read', exact: true })).toBeVisible();
  });

  test('switches to test mode: its keys and pages are kept apart from the live ones', async ({ page }) => {
    const live = `e2e-live-${Date.now()}`;
    const inTest = `e2e-test-${Date.now()}`;
    await createApiKey(page, live);

    await page.getByRole('button', { name: 'Test mode' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'working on test data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Test mode' })).toHaveAttribute('aria-pressed', 'true');
    await expectAccessible(page);
    await expect(page.getByRole('link', { name: 'Billing' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Users' })).toBeHidden();
    expect((await page.goto('/billing'))?.status()).toBe(404);

    expect(await createApiKey(page, inTest)).toMatch(/^sk_test_/);
    await expectAccessible(page);
    await expect(page.getByRole('row').filter({ hasText: live })).toBeHidden();

    await page.getByRole('button', { name: 'Test mode' }).click();
    await expect(page.getByRole('button', { name: 'Test mode' })).toHaveAttribute('aria-pressed', 'false');
    await page.goto('/api-keys');
    await expect(page.getByRole('row').filter({ hasText: live })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: inTest })).toBeHidden();
  });

  test('filters the audit log by actor', async ({ page }) => {
    await createApiKey(page, `e2e-audit-${Date.now()}`);
    await page.goto('/audit');
    // Filtered: tests running in parallel sign in to this tenant too, which is audited.
    const first = page.getByRole('row').filter({ hasText: 'POST /v1/api-keys' }).first();
    await expect(first).toBeVisible();

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

test.describe('On a phone', () => {
  test.use({ storageState: sessionFile('admin'), viewport: { width: 390, height: 844 } });

  test('the sidebar is a menu button: its links show only when it is open', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main' });
    const opener = page.getByRole('button', { name: 'Open menu' });
    await expect(nav).toBeHidden();
    await expect(opener).toHaveAttribute('aria-expanded', 'false');
    // The header's controls wrap rather than run off the screen.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });

    await opener.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    await nav.getByRole('link', { name: 'Audit log' }).click();
    await expect(page).toHaveURL(/\/audit$/);
    await expect(nav).toBeHidden();

    // Escape closes it and gives the button its focus back; Ctrl+K opens it at its search.
    await opener.click();
    await expect(nav).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(opener).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(nav.getByRole('searchbox', { name: 'Search pages' })).toBeFocused();
    await expectAccessible(page);
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

    test('sends a test event and reads its delivery, refused at the private address', async ({ page }) => {
      const url = `https://localhost/e2e-${Date.now()}`;
      await page.goto('/webhooks');
      await page.getByLabel('Endpoint URL').fill(url);
      await page.getByRole('button', { name: 'Add endpoint' }).click();
      const row = page.getByRole('row').filter({ hasText: url });
      await row.getByRole('button', { name: 'Send test' }).click();
      await expect(row.getByText('Test event sent')).toBeVisible();

      await row.getByRole('link', { name: `Deliveries of ${url}` }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Deliveries' })).toBeVisible();
      await expect(async () => {
        await page.reload();
        await expect(page.getByRole('cell', { name: 'webhook.test' })).toBeVisible({ timeout: 1000 });
      }).toPass();
      await expect(page.getByRole('cell', { name: 'Address refused' })).toBeVisible();
      await expectAccessible(page);

      await page.getByRole('button', { name: 'Redeliver' }).click();
      await expect(page.getByText('Redelivery queued.')).toBeVisible();
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

test.describe('Feature flags', () => {
  test.use({ storageState: sessionFile('super') });

  // On Beta, so Acme's webhook tests never see the feature go away.
  test('a SuperAdmin turns a feature off for a tenant; its admin loses it, sees why, and cannot change it', async ({ page, browser, baseURL }) => {
    const { tenants, emails } = fixtures();
    await page.goto('/tenants');
    await page.getByRole('button', { name: `Open ${tenants.beta.name}` }).click();
    await expect(page.getByRole('heading', { level: 2, name: tenants.beta.name })).toBeVisible();

    const setOverride = async (choice: string) => {
      await page.goto('/settings');
      await page.getByRole('tab', { name: 'Features' }).click();
      const panel = page.getByRole('tabpanel');
      await expect(panel.getByText(tenants.beta.name)).toBeVisible();
      await panel.getByRole('combobox', { name: 'Override for Webhooks' }).click();
      await page.getByRole('option', { name: choice }).click();
      await panel.getByRole('button', { name: 'Save' }).click();
      await expect(panel.getByText('Saved')).toBeVisible();
      return panel;
    };

    const panel = await setOverride('Always off');
    await expect(panel.getByText('Off', { exact: true })).toBeVisible();
    await expect(panel.getByText('Set by the platform for this tenant')).toBeVisible();
    await expectAccessible(page);

    const admin = await (await browser.newContext({ baseURL })).newPage();
    await signIn(admin, emails.betaadmin);
    await expect(admin.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Webhooks' })).toHaveCount(0);
    expect((await admin.goto('/webhooks'))?.status()).toBe(404);

    await admin.goto('/settings');
    await admin.getByRole('tab', { name: 'Features' }).click();
    const seen = admin.getByRole('tabpanel');
    await expect(seen.getByText('Off', { exact: true })).toBeVisible();
    await expect(seen.getByRole('combobox')).toHaveCount(0);
    await expect(seen.getByRole('button')).toHaveCount(0);
    await expectAccessible(admin);

    const restored = await setOverride('Plan default');
    await expect(restored.getByText('Included in every plan')).toBeVisible();
    expect((await admin.goto('/webhooks'))?.status()).toBe(200);
    await admin.context().close();
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
