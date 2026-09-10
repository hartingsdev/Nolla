import { expect, test } from '@playwright/test';
import { loadSample } from './helpers';

test('freeze → only payments; close blocked until zero; close; reopen', async ({ page }) => {
  await loadSample(page);
  await page.goto('/trip/settings');
  await page.getByRole('button', { name: 'Freeze plan' }).click();
  await expect(page.getByText('Balances are not all zero yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close trip' })).toBeDisabled();

  await page.goto('/');
  await expect(page.getByText('Plan frozen: only payments can be recorded.', { exact: false })).toBeVisible();
  // The write rule is asserted where it lives — in the form — rather than by
  // reading it off the button's label, which is the coupling #15 removed.
  await page.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByText('New payment')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expense', exact: true })).toHaveCount(0);
  await page.goto('/');

  // editing is blocked while settling
  await page.goto('/ledger');
  await page.getByText('Lidl Samstag').first().click();
  await expect(page.getByRole('button', { name: 'Edit entry' })).toHaveCount(0);

  // settle everything, then closing becomes possible
  await page.goto('/settle');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Mark paid' }).first().click();
  await page.goto('/trip/settings');
  await page.getByRole('button', { name: 'Close trip' }).click();
  await expect(page.getByText('Closed and read-only.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add entry' })).toHaveCount(0);

  await page.goto('/trip/settings');
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('Expenses and payments can be recorded.')).toBeVisible();
});
