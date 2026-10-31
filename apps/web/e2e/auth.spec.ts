import { expect, test } from '@playwright/test';
import { fixtures, signIn } from './fixtures';

test('a member signs in with email and password, and signs out', async ({ page }) => {
  const { emails, tenants } = fixtures();
  await signIn(page, emails.admin);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('banner').getByText(tenants.acme.name)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The session is gone: the dashboard sends us back.
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
});

test('an expired access cookie is renewed without anyone noticing, on the page they were on', async ({ page, context }) => {
  await signIn(page, fixtures().emails.admin);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  const refresh = (await context.cookies()).find((c) => c.name === 'refresh');
  expect(refresh?.httpOnly).toBe(true);

  await context.clearCookies({ name: 'session' });
  await page.goto('/settings?from=expired');
  await expect(page).toHaveURL(/\/settings\?from=expired$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name === 'session')).toBe(true);
  expect(cookies.find((c) => c.name === 'refresh')?.value).not.toBe(refresh?.value);
});

test('a page whose access token is refused renews the session, and a session that ended goes to sign-in', async ({ page, context }) => {
  await signIn(page, fixtures().emails.admin);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  const session = (await context.cookies()).find((c) => c.name === 'session')!;
  await context.addCookies([{ ...session, value: 'not-a-valid-token' }]);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  await context.addCookies([{ ...session, value: 'not-a-valid-token' }]);
  const refresh = (await context.cookies()).find((c) => c.name === 'refresh')!;
  await context.addCookies([{ ...refresh, value: 'not-a-valid-refresh-token' }]);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some((c) => c.name === 'refresh')).toBe(false);
});

test('a renewal keeps the tenant a SuperAdmin has open', async ({ page, context }) => {
  const { tenants, emails } = fixtures();
  await signIn(page, emails.super);
  await page.getByRole('link', { name: 'Tenants' }).click();
  await page.getByRole('button', { name: `Open ${tenants.acme.name}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  const tenant = (await context.cookies()).find((c) => c.name === 'tenant')?.value;
  expect(tenant).toBeTruthy();

  await context.clearCookies({ name: 'session' });
  await page.goto('/users');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === 'tenant')?.value).toBe(tenant);
});

test('the refresh route never redirects to another site', async ({ page }) => {
  await signIn(page, fixtures().emails.admin);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  for (const next of ['https://example.com/', '//example.com/', '/\\example.com/']) {
    await page.goto(`/session/refresh?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/localhost:\d+\/$/);
  }
});

test('signed out, / is the landing page, which leads to sign-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
});

test('the landing page lists the new features, and its header link glides to them', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('navigation', { name: 'Main' });
  await main.getByRole('link', { name: 'Features' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // Part of the way there: a jump would already have arrived.
  const landed = await page.evaluate(() => document.getElementById('features')!.getBoundingClientRect().top);
  expect(landed).toBeGreaterThan(100);
  await expect(page.getByRole('heading', { level: 3, name: 'Per-tenant feature flags' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Observability' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('features')!.getBoundingClientRect().top))).toBeLessThan(100);
});

test('the landing page jumps instead for people who ask for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Features' }).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('features')!.getBoundingClientRect().top))).toBeLessThan(100);
});

test('a wrong password is announced on the form', async ({ page }) => {
  await signIn(page, fixtures().emails.admin, 'not the right password');
  await expect(page.getByText('Invalid credentials')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('an email with accounts in two tenants is asked which one, never for a tenant ID', async ({ page }) => {
  const { emails, tenants } = fixtures();
  await signIn(page, emails.multi);
  await expect(page.getByRole('group', { name: 'Sign in to which tenant?' })).toBeVisible();
  await page.getByRole('radio', { name: tenants.beta.name }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 2, name: tenants.beta.name })).toBeVisible();
});

test('keyboard only: sign in, then skip to the content', async ({ page }) => {
  const { emails, password } = fixtures();
  await page.goto('/login');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email')).toBeFocused();
  await page.keyboard.type(emails.admin);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password')).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  // The first Tab on every dashboard page reaches the skip link, visible once focused.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});
