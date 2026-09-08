import { expect, type Page } from '@playwright/test';

export async function fresh(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto('/');
}

export async function loadSample(page: Page, me = 'Yannik'): Promise<void> {
  await fresh(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Load sample trip' }).click();
  await page.goto('/');
  await page.getByRole('button', { name: me, exact: true }).click();
  await expect(page.getByText(/You owe|You get back|You are settled/)).toBeVisible();
}

/** Parse "€1,234.56" / "-€8.75" as integer cents. */
export function cents(text: string): bigint {
  const m = /(-?)€?(-?)([\d,]+)\.(\d{2})/.exec(text);
  if (!m) throw new Error(`no money in ${JSON.stringify(text)}`);
  const neg = m[1] === '-' || m[2] === '-';
  const v = BigInt(m[3]!.replace(/,/g, '')) * 100n + BigInt(m[4]!);
  return neg ? -v : v;
}

/** The overview's balance rows must sum to zero — invariant I2 as the user sees it. */
export async function expectBalancesSumToZero(page: Page): Promise<void> {
  await page.goto('/');
  const rows = page.getByRole('button', { name: /owes €|gets back €|settled/ });
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  let sum = 0n;
  for (let i = 0; i < n; i++) {
    const text = await rows.nth(i).innerText();
    if (text.includes('settled')) continue;
    const v = cents(text);
    sum += text.includes('owes') ? -v : v;
  }
  expect(sum).toBe(0n);
}

/** Payer chips toggle; the form starts with "me" (Yannik) selected. Make `name` the only payer. */
export async function setPayer(page: Page, name: string, me = 'Yannik'): Promise<void> {
  if (name === me) return;
  await page.getByRole('button', { name: me, exact: true }).first().click();   // deselect me
  await page.getByRole('button', { name, exact: true }).first().click();       // select payer
}

export async function addExpense(page: Page, opts: { amount: string; description: string; payer?: string; exclude?: string[]; refund?: boolean }): Promise<void> {
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill(opts.amount);
  await page.getByLabel('Description').first().fill(opts.description);
  if (opts.refund) await page.getByRole('switch').first().check();
  await setPayer(page, opts.payer ?? 'Yannik');
  for (const name of opts.exclude ?? []) await page.getByRole('button', { name, exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/$/);
}
