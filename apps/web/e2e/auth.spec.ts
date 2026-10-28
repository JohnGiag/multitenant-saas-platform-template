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
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
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
