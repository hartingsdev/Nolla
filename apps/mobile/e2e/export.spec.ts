import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { loadSample } from './helpers';

test.beforeEach(async ({ page }) => { await loadSample(page); });

/** Reads a download's bytes as text, BOM and all. */
async function downloadCsv(page: Page): Promise<{ name: string; text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export as CSV|Als CSV exportieren/ }).click(),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: await readFile(path, 'utf8') };
}

test('exports the trip as a spreadsheet-shaped CSV (FR-7.8)', async ({ page }) => {
  await page.goto('/trip/settings');
  const { name, text } = await downloadCsv(page);
  expect(name).toBe(`elsass-2026-${new Date().toISOString().slice(0, 10)}.csv`);
  expect(text.codePointAt(0)).toBe(0xfeff); // BOM, or Excel mangles the umlauts

  const rows = text.replace(/^\uFEFF/, '').split('\r\n').map((r) => r.split(','));
  expect(rows[0]?.slice(0, 2)).toEqual(['Trip', 'Elsass 2026']);

  // One column per participant, in the order the trip lists them.
  const header = rows.find((r) => r[0] === 'Date') as string[];
  expect(header.slice(0, 7)).toEqual(['Date', 'Type', 'Description', 'Reason', 'Category', 'Amount', 'Paid by']);
  expect(header.slice(7, 12)).toEqual(['Yannik', 'Max', 'Robert', 'Tobias', 'Marc']);

  // The €55.18 three-way row keeps its sub-cent shares.
  const einkauf = rows.find((r) => r[2] === 'Einkauf Krefeld') as string[];
  expect(einkauf[5]).toBe('55.18');
  expect(einkauf.slice(7, 12).every((c) => c.startsWith('11.036'))).toBe(true);

  // Totals close: both sides equal the trip cost and balances cancel.
  const total = rows.find((r) => r[0] === 'Total') as string[];
  expect(total[1]).toBe(total[2]);
  expect(total[4]).toBe('0.00');

  // The plan the settle tab would show is appended.
  expect(rows.some((r) => r[0] === 'Settlement')).toBe(true);
});

test('German export uses semicolons and decimal commas, so Excel parses it', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'DE', exact: true }).click();
  await page.goto('/trip/settings');
  const { text } = await downloadCsv(page);
  const rows = text.replace(/^\uFEFF/, '').split('\r\n').map((r) => r.split(';'));
  expect(rows[0]?.slice(0, 2)).toEqual(['Reise', 'Elsass 2026']);
  const einkauf = rows.find((r) => r[2] === 'Einkauf Krefeld') as string[];
  expect(einkauf[5]).toBe('55,18');
  expect(rows.find((r) => r[0] === 'Gesamt')).toBeTruthy();
});

test('an entry added in the app appears in the next export', async ({ page }) => {
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill('20');
  await page.getByLabel('Description').first().fill('Seilbahn');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/trip/settings');
  const { text } = await downloadCsv(page);
  expect(text).toContain('Seilbahn');
});
