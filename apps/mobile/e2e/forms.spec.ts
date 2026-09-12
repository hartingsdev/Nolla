import { expect, test } from '@playwright/test';
import { expectSaveRefused, loadSample } from './helpers';

test.beforeEach(async ({ page }) => { await loadSample(page); });

/**
 * NFR-16: a form marks what it needs before anyone presses save, and once
 * pressed it names the first problem and marks every field that failed — the
 * difference between a form that refuses and a form that explains.
 */
test('the entry form marks what it needs and names what is wrong (NFR-16)', async ({ page }) => {
  await page.goto('/entry/new');
  // Required before anyone has pressed anything…
  await expect(page.getByText('Amount *')).toBeVisible();
  await expect(page.getByText('Description *')).toBeVisible();
  // …but nothing is called wrong yet.
  await expect(page.getByText('Enter an amount')).toHaveCount(0);

  await expectSaveRefused(page, 'Enter an amount');

  // The complaint is derived, not latched: it moves on to the next problem as
  // each field is fixed, rather than waiting for another attempt.
  await page.getByLabel('Amount').first().fill('20');
  await expect(page.getByText('Enter an amount')).toHaveCount(0);
  await expect(page.getByText('Add a description').first()).toBeVisible();

  await page.getByLabel('Description').first().fill('Gelato');
  await expect(page.getByText('Add a description')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/ledger');
  await expect(page.getByText('Gelato').first()).toBeVisible();
});

test('nobody in the split: the form says so rather than going quiet (NFR-16)', async ({ page }) => {
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill('20');
  await page.getByLabel('Description').first().fill('Taxi');
  for (const name of ['Yannik', 'Max', 'Robert', 'Tobias', 'Marc']) {
    await page.getByRole('button', { name, exact: true }).nth(1).click();   // the split row
  }
  await expectSaveRefused(page, 'Pick at least one person');
});

test('the participant form asks for a name (NFR-16)', async ({ page }) => {
  await page.goto('/trip/participants');
  await expect(page.getByText('Add participant *')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Enter a name')).toBeVisible();

  await page.getByLabel('Name', { exact: true }).first().fill('Nils');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Enter a name')).toHaveCount(0);
  await expect(page.getByText('Nils').first()).toBeVisible();
});

test('the trip list asks for a name (NFR-16)', async ({ page }) => {
  await page.goto('/trips');
  await page.getByRole('button', { name: 'New trip on this device' }).click();
  await expect(page.getByText('Enter a name for the trip')).toBeVisible();

  await page.getByLabel('New trip on this device').fill('Lisbon');
  await expect(page.getByText('Enter a name for the trip')).toHaveCount(0);
  await page.getByRole('button', { name: 'New trip on this device' }).click();
  await expect(page.getByRole('heading', { name: 'Lisbon' })).toBeVisible();
});
