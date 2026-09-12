import { type Page, expect, test } from '@playwright/test';
import { cents, expectBalancesSumToZero, expectSaveRefused, loadSample } from './helpers';

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
  // Neither side is named yet, so saving says so rather than sitting there disabled (NFR-16).
  await expectSaveRefused(page, 'Pick two different people');
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
  await expectSaveRefused(page, 'Say why this adjustment is needed');
  // The complaint is derived, not latched: typing the reason clears it.
  await page.getByLabel('Reason', { exact: true }).fill('Split a taxi we forgot to log');
  await expect(page.getByText('Say why this adjustment is needed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/ledger');
  await expect(page.getByText(/Reason: Split a taxi we forgot to log/)).toBeVisible();
});

test('an adjustment between one person and the group (FR-6.1)', async ({ page }) => {
  const before = await myBalance(page);

  await page.goto('/entry/new');
  await page.getByRole('button', { name: 'Adjustment', exact: true }).click();
  await page.getByRole('button', { name: 'One person and the group' }).click();
  await page.getByLabel('Amount').first().fill('80');
  await page.getByLabel('Reason', { exact: true }).fill('Robert broke the lamp');

  // Robert takes €80 on; the other four are credited €20 each.
  await page.getByRole('button', { name: 'Robert', exact: true }).first().click();
  await expect(page.getByText('Robert takes the amount on; the others are credited their share.')).toBeVisible();
  await expect(page.getByText('€20.00 per person')).toBeVisible();   // the four others, Robert excluded
  await page.getByRole('button', { name: 'Save' }).click();

  // Yannik is one of the others, so he is €20 better off; the ledger still closes.
  const after = await myBalance(page);
  expect(after - before).toBe(2000n);
  await expectBalancesSumToZero(page);

  await page.goto('/ledger');
  await page.getByRole('button', { name: 'Adjustment', exact: true }).click();
  await expect(page.getByText(/Reason: Robert broke the lamp/)).toBeVisible();
});

test('the group can owe one person, which is the same correction the other way (FR-6.1)', async ({ page }) => {
  const before = await myBalance(page);

  await page.goto('/entry/new');
  await page.getByRole('button', { name: 'Adjustment', exact: true }).click();
  await page.getByRole('button', { name: 'One person and the group' }).click();
  await page.getByLabel('Amount').first().fill('80');
  await page.getByLabel('Reason', { exact: true }).fill('Robert paid the deposit alone');
  await page.getByRole('button', { name: 'Robert', exact: true }).first().click();
  await page.getByRole('button', { name: '…is owed by the others' }).click();
  await expect(page.getByText('The others take the amount on; Robert is credited it.')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();

  // Now Yannik carries €20 of it instead.
  expect(await myBalance(page) - before).toBe(-2000n);
  await expectBalancesSumToZero(page);
});
