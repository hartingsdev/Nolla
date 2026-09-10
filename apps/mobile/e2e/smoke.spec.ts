import { expect, test } from '@playwright/test';
import { expectBalancesSumToZero, fresh, loadSample } from './helpers';

test('a fresh install asks for people, and the ask leads somewhere (#4, #11)', async ({ page }) => {
  await fresh(page);
  // The old empty state asked for an expense that could not be saved, because
  // the form has no payer to offer until somebody exists.
  await expect(page.getByText('Add the people you are splitting with — they need no account.')).toBeVisible();
  await page.getByRole('button', { name: 'Add people' }).click();
  await expect(page).toHaveURL(/\/trip\/participants$/);
});

test('app-level destinations are not buried in a card header (#6)', async ({ page }) => {
  await loadSample(page);
  // "Trips" and "Settings" used to sit in the Recent entries heading row.
  await expect(page.getByRole('button', { name: 'Trips' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trip settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Trip settings' }).click();
  await expect(page).toHaveURL(/\/trip\/settings$/);
  await expect(page.getByText('These apply to this trip only.')).toBeVisible();
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
