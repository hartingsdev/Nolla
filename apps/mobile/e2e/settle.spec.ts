import { expect, test } from '@playwright/test';
import { expectBalancesSumToZero, loadSample } from './helpers';

test.beforeEach(async ({ page }) => { await loadSample(page); });

test('fewest-transfers plan is minimal and clears to zero when every transfer is marked paid', async ({ page }) => {
  await page.goto('/settle');
  await expect(page.getByText('4 transfers · provably minimal')).toBeVisible();
  await expect(page.getByText('Yannik pays Marc')).toBeVisible();
  // rounding card names who absorbed the sub-cent residual
  await expect(page.getByText(/under a cent/).first()).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Mark paid' }).first().click();
  }
  await expect(page.getByText('Everyone is settled.')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('You are settled')).toBeVisible();
  await page.goto('/ledger');
  await expect(page.getByText('Payment', { exact: false }).first()).toBeVisible();
  await expectBalancesSumToZero(page);
});

test('the three plan kinds are selectable and all show transfers', async ({ page }) => {
  await page.goto('/settle');
  await page.getByRole('button', { name: 'Pay who you owe' }).click();
  await expect(page.getByText(/\d+ transfers?$/).first()).toBeVisible();
  await page.getByRole('button', { name: /^Via / }).click();
  await page.getByRole('button', { name: 'Robert', exact: true }).click();
  await expect(page.getByText(/pays Robert|Robert pays/).first()).toBeVisible();
  const rows = await page.getByText(/ pays /).allInnerTexts();
  expect(rows.every((r) => r.includes('Robert'))).toBe(true);
});

test('each plan explains its trade-off and says what it saves over paying who you owe (FR-8.3, FR-8.4)', async ({ page }) => {
  await page.goto('/settle');

  /** The leading "N transfers" of the plan summary. */
  const count = async (): Promise<number> => {
    const text = await page.getByText(/^\d+ transfers?\b/).first().innerText();
    return Number(/^(\d+)/.exec(text)![1]);
  };

  // Paying who you owe: the plan the group builds by hand, and the baseline.
  await page.getByRole('button', { name: 'Pay who you owe' }).click();
  await expect(page.getByText(/Everyone pays exactly the person they owe/)).toBeVisible();
  await expect(page.getByText(/fewer than paying who you owe/)).toHaveCount(0);   // no comparison with itself
  const byHand = await count();

  // Fewest transfers: never more than the baseline, and it says by how much.
  await page.getByRole('button', { name: 'Fewest transfers' }).click();
  await expect(page.getByText(/The fewest transfers that clear every balance/)).toBeVisible();
  const optimal = await count();
  expect(optimal).toBeLessThanOrEqual(byHand);
  const saved = byHand - optimal;
  await expect(page.getByText(saved > 0 ? `${saved} transfer${saved === 1 ? '' : 's'} fewer than paying who you owe` : 'no fewer than paying who you owe')).toBeVisible();

  // Via one person: one transfer per member with a balance, and never fewer than optimal.
  await page.getByRole('button', { name: /^Via / }).click();
  await expect(page.getByText(/Everyone settles with .* alone/)).toBeVisible();
  expect(await count()).toBeGreaterThanOrEqual(optimal);
});
