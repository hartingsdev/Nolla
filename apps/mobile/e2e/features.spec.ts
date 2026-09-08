import { expect, test } from '@playwright/test';
import { expectBalancesSumToZero, loadSample } from './helpers';

test.beforeEach(async ({ page }) => { await loadSample(page); });

test('categories: picked in the form, shown in ledger and detail', async ({ page }) => {
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill('12');
  await page.getByLabel('Description').first().fill('Autobahn');
  await page.getByRole('button', { name: /Tolls/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/ledger');
  await expect(page.getByText('🛣️ Autobahn')).toBeVisible();
  await page.getByText('🛣️ Autobahn').click();
  await expect(page.getByText(/· Tolls$/)).toBeVisible();
});

test('"same again" prefills a new expense with today\'s date', async ({ page }) => {
  await page.goto('/ledger');
  await page.getByText('Tanken Samstag').first().click();
  await page.getByRole('button', { name: 'Same again' }).click();
  await expect(page.getByLabel('Amount').first()).toHaveValue('72.53');
  await expect(page.getByLabel('Description').first()).toHaveValue('Tanken Samstag');
  const today = new Date().toISOString().slice(0, 10);
  await expect(page.getByLabel('Date').first()).toHaveValue(today);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/ledger');
  await expect(page.getByText('Tanken Samstag')).toHaveCount(2);
  await expectBalancesSumToZero(page);
});

test('marking my share paid records a payment to the payer and flags the share', async ({ page }) => {
  await page.goto('/ledger');
  await page.getByText('Einkauf Krefeld').first().click();
  await page.getByRole('button', { name: 'Mark my share paid' }).click();
  await expect(page.getByText(/Yannik ✓ paid/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark my share paid' })).toHaveCount(0);
  await page.goto('/ledger');
  await page.getByRole('button', { name: 'Payment', exact: true }).click();
  await expect(page.getByText('Share of Einkauf Krefeld')).toBeVisible();
  await expect(page.getByText('Yannik → Marc')).toBeVisible();
  await expectBalancesSumToZero(page);
});

test('deleting the linked payment un-flags the share', async ({ page }) => {
  await page.goto('/ledger');
  await page.getByText('Einkauf Krefeld').first().click();
  await page.getByRole('button', { name: 'Mark my share paid' }).click();
  await page.goto('/ledger');
  await page.getByText('Share of Einkauf Krefeld').first().click();
  page.once('dialog', (d) => { void d.accept(); });
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.goto('/ledger');
  await page.getByText('Einkauf Krefeld').first().click();
  await expect(page.getByRole('button', { name: 'Mark my share paid' })).toBeVisible();
});

test('who-owes-whom matrix shows gross debts before netting', async ({ page }) => {
  await page.goto('/settle');
  await page.getByRole('button', { name: 'Who owes whom' }).click();
  await expect(page.getByText('Rows owe columns, before netting.')).toBeVisible();
  // Yannik, Max and Tobias each owe Robert 1/5 of (465.35 + 75.00) = 108.07; Marc nets against his own payments
  await expect(page.getByText('€108.07')).toHaveCount(3);
  await page.getByRole('button', { name: 'Plans' }).click();
  await expect(page.getByText(/provably minimal/)).toBeVisible();
});

test('ledger search and filters narrow the list', async ({ page }) => {
  await page.goto('/ledger');
  await page.getByLabel('Search').fill('lidl');
  await expect(page.getByText('Lidl Samstag')).toBeVisible();
  await expect(page.getByText('Rulantica')).toHaveCount(0);
  await page.getByLabel('Search').fill('');
  await page.getByRole('button', { name: 'Payment', exact: true }).click();
  await expect(page.getByText('No entries match.')).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: 'Robert', exact: true }).click();
  await expect(page.getByText('Essen Saarbrücken')).toHaveCount(0); // Robert neither paid nor shared it
  await expect(page.getByText('Miete 1/2')).toBeVisible();
});
