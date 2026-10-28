import { expect, test } from '@playwright/test';
import { expectAccessible } from './fixtures';

test('the language switcher turns the page Greek, and the choice sticks', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Ελληνικά' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Σύνδεση');
  // Screen readers pronounce the page as Greek.
  await expect(page.locator('html')).toHaveAttribute('lang', 'el');
  await expectAccessible(page);

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Γλώσσα' })).toHaveText('Ελληνικά');
});

test.describe('a browser that prefers Greek', () => {
  test.use({ locale: 'el-GR' });

  test('gets Greek without choosing', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'el');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Σύνδεση');
  });
});
