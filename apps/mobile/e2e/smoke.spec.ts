import { expect, test } from '@playwright/test';
import { expectBalancesSumToZero, fresh, loadSample } from './helpers';

test('empty state invites the first expense', async ({ page }) => {
  await fresh(page);
  await expect(page.getByText('No expenses yet. Tap + to add the first one.')).toBeVisible();
});

test('sample trip: headline, balances and trip cost', async ({ page }) => {
  await loadSample(page);
  await expect(page.getByText('You owe €128.92')).toBeVisible(); // exact −128.916, see §5.1
  await expect(page.getByText('€945.48')).toBeVisible();
  await expect(page.getByRole('button', { name: /Robert.*gets back €350.65/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Marc.*gets back €141.90/ })).toBeVisible();
  await expectBalancesSumToZero(page);
});

test('data survives a reload (local persistence)', async ({ page }) => {
  await loadSample(page);
  await page.reload();
  await expect(page.getByText('You owe €128.92')).toBeVisible();
});

test('language switch changes the UI to German', async ({ page }) => {
  await loadSample(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'DE', exact: true }).click();
  await expect(page.getByText('Beispielreise laden')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Du schuldest 128,92 €')).toBeVisible();
});
