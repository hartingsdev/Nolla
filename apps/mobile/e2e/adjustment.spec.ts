import { type Page, expect, test } from '@playwright/test';
import { cents, expectBalancesSumToZero, loadSample } from './helpers';

test.beforeEach(async ({ page }) => { await loadSample(page); });

/** Yannik's balance on the overview, in cents, signed the way the app reads it. */
async function myBalance(page: Page): Promise<bigint> {
  await page.goto('/');
  const row = page.getByRole('button', { name: /^Yannik/ }).first();
  const text = await row.innerText();
  if (text.includes('settled')) return 0n;
  const v = cents(text);
  return text.includes('owes') ? -v : v;
}

test('an adjustment moves money between two people and keeps a reason (FR-6.1)', async ({ page }) => {
  const before = await myBalance(page);

  await page.goto('/entry/new');
  await page.getByRole('button', { name: 'Adjustment', exact: true }).click();
  await page.getByLabel('Amount').first().fill('25');
  await page.getByLabel('Reason', { exact: true }).fill('Robert paid Max in cash before the trip');
  // Save stays out of reach until both sides are named.
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByRole('button', { name: 'Robert', exact: true }).first().click();   // from
  await page.getByRole('button', { name: 'Max', exact: true }).nth(1).click();       // to
  await page.getByRole('button', { name: 'Save' }).click();

  await page.goto('/ledger');
  await page.getByRole('button', { name: 'Adjustment', exact: true }).click();       // the ledger filter
  await expect(page.getByText('Robert → Max')).toBeVisible();
  await expect(page.getByText(/Reason: Robert paid Max in cash/)).toBeVisible();

  await page.getByText('🧾 Adjustment').first().click();
  // The ledger stays mounted (and hidden) under the pushed screen, so the copy
  // on top is the last match, not the first.
  await expect(page.getByRole('heading', { name: 'Adjustment' })).toBeVisible();
  await expect(page.getByText(/Reason: Robert paid Max in cash/).last()).toBeVisible();
  await expect(page.getByText('€25.00').last()).toBeVisible();

  // Two-sided by construction: it cannot move anyone else's balance, or the trip's total.
  expect(await myBalance(page)).toBe(before);
  await expectBalancesSumToZero(page);

  // …and the summary lists it, so a correction is never buried in the ledger (FR-6.2).
  await page.goto('/');
  await expect(page.getByText('Adjustments', { exact: true })).toBeVisible();
  await expect(page.getByText('Corrections booked by hand, outside the expenses.')).toBeVisible();
  await expect(page.getByText('Robert paid Max in cash before the trip').first()).toBeVisible();
  await expect(page.getByText('€25.00').first()).toBeVisible();
});

test('an adjustment without a reason cannot be saved (FR-6.1)', async ({ page }) => {
  await page.goto('/entry/new');
  await page.getByRole('button', { name: 'Adjustment', exact: true }).click();
  await page.getByLabel('Amount').first().fill('10');
  await page.getByRole('button', { name: 'Robert', exact: true }).first().click();
  await page.getByRole('button', { name: 'Max', exact: true }).nth(1).click();
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.getByLabel('Reason', { exact: true }).fill('Split a taxi we forgot to log');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
});
