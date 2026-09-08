import { expect, test } from '@playwright/test';
import { addExpense, expectBalancesSumToZero, loadSample, setPayer } from './helpers';

test.beforeEach(async ({ page }) => { await loadSample(page); });

test('equal split: €55.18 five ways previews €11.04 and stores 11.036 exactly', async ({ page }) => {
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill('55,18');
  await expect(page.getByText('€11.04 per person')).toBeVisible();
  await page.getByLabel('Description').first().fill('Groceries');
  await setPayer(page, 'Marc');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/ledger');
  await page.getByText('Groceries').first().click();
  const amounts = await page.getByText(/^€11\.0[34]$/).allInnerTexts();
  expect(amounts.sort()).toEqual(['€11.03', '€11.03', '€11.04', '€11.04', '€11.04']);
  await expect(page.getByText(/stored exactly as 11\.036 EUR/i).first()).toBeVisible();
  await expectBalancesSumToZero(page);
});

test('exact split cannot be saved with a residual; "put the rest on" fixes it', async ({ page }) => {
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill('120');
  await page.getByLabel('Description').first().fill('Casamore');
  await setPayer(page, 'Marc');
  await page.getByRole('button', { name: 'Exact amounts' }).click();
  await page.getByLabel('Yannik', { exact: true }).fill('29.45');
  await page.getByLabel('Max', { exact: true }).fill('0');
  await page.getByLabel('Robert', { exact: true }).fill('32.45');
  await page.getByLabel('Tobias', { exact: true }).fill('36.12');
  await page.getByLabel('Marc', { exact: true }).fill('21.95');
  await expect(page.getByText('€0.03 left to assign')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByRole('button', { name: 'Put the rest on Marc' }).click();
  await expect(page.getByText(/left to assign/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/ledger');
  await page.getByText('Casamore').first().click();
  await expect(page.getByText('€21.98')).toBeVisible();
  await expectBalancesSumToZero(page);
});

test('excluding a participant splits among the rest (Rulantica)', async ({ page }) => {
  await addExpense(page, { amount: '168', description: 'Park', payer: 'Marc', exclude: ['Marc'] });
  await page.goto('/ledger');
  await page.getByText('Park').first().click();
  const amounts = await page.getByText(/^€42\.00$/).allInnerTexts();
  expect(amounts).toHaveLength(4);
  await expectBalancesSumToZero(page);
});

test('a refund is a negative expense and reduces trip cost', async ({ page }) => {
  await addExpense(page, { amount: '8,75', description: 'Deposit back', payer: 'Marc', refund: true });
  await expect(page.getByText('-€8.75').first()).toBeVisible();
  await expect(page.getByText('€936.73')).toBeVisible(); // 945.48 − 8.75
  await expectBalancesSumToZero(page);
});

test('two payers must add up to the total', async ({ page }) => {
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill('100');
  await page.getByLabel('Description').first().fill('Fuel');
  await page.getByRole('button', { name: 'Robert', exact: true }).first().click(); // adds Robert as second payer next to Yannik (me)
  await page.getByLabel('Paid by Yannik').fill('60');
  await expect(page.getByText('€40.00 of the total still unassigned to a payer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByRole('button', { name: 'Put the rest on Robert' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/ledger');
  await expect(page.getByText('paid by Yannik, Robert')).toBeVisible();
  await expectBalancesSumToZero(page);
});
