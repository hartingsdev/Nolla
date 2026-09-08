import { expect, test } from '@playwright/test';
import { loadSample } from './helpers';

test('freeze → only payments; close blocked until zero; close; reopen', async ({ page }) => {
  await loadSample(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Freeze plan' }).click();
  await expect(page.getByText('Balances are not all zero yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close trip' })).toBeDisabled();

  await page.goto('/');
  await expect(page.getByText('Plan frozen: only payments can be recorded.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add expense' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record payment' }).first()).toBeVisible();

  // editing is blocked while settling
  await page.goto('/ledger');
  await page.getByText('Lidl Samstag').first().click();
  await expect(page.getByRole('button', { name: 'Edit entry' })).toHaveCount(0);

  // settle everything, then closing becomes possible
  await page.goto('/settle');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Mark paid' }).first().click();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Close trip' }).click();
  await expect(page.getByText('Closed and read-only.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Record payment|Add expense/ })).toHaveCount(0);

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('Expenses and payments can be recorded.')).toBeVisible();
});
