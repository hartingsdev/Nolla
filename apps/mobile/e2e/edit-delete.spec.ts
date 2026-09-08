import { expect, test } from '@playwright/test';
import { expectBalancesSumToZero, loadSample } from './helpers';

test.beforeEach(async ({ page }) => { await loadSample(page); });

test('edit changes description and date and keeps balances consistent', async ({ page }) => {
  await page.goto('/ledger');
  await page.getByText('Lidl Samstag').first().click();
  await page.getByRole('button', { name: 'Edit entry' }).click();
  await page.getByLabel('Description').first().fill('Lidl Saturday');
  await page.getByLabel('Date').first().fill('2026-03-05');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Lidl Saturday' })).toBeVisible();
  await expect(page.getByText('Mar 5 · Expense', { exact: true })).toBeVisible();
  await expectBalancesSumToZero(page);
});

test('delete is reversible and visible in the ledger', async ({ page }) => {
  await page.goto('/ledger');
  await page.getByText('Maut Tobias').first().click();
  page.once('dialog', (d) => { void d.accept(); });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.goto('/ledger');
  await expect(page.getByText('Maut Tobias')).toHaveCount(0);
  await page.getByRole('button', { name: /Show deleted \(1\)/ }).click();
  await expect(page.getByText('Maut Tobias · deleted')).toBeVisible();
  await page.getByText('Maut Tobias · deleted').click();
  await expect(page.getByText('This entry is deleted.')).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.goto('/ledger');
  await expect(page.getByText('Maut Tobias')).toBeVisible();
  await expectBalancesSumToZero(page);
});

test('person drill-down shows paid, share and the entries involving them', async ({ page }) => {
  await page.getByRole('button', { name: /^Robert/ }).click();
  await expect(page.getByText('gets back €350.65').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText('€540.35').filter({ visible: true }).first()).toBeVisible(); // paid
  await expect(page.getByText('Miete 1/2').filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/paid €465\.35 · share €93\.07/)).toBeVisible();
});
