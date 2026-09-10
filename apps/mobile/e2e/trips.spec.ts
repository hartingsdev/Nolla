import { expect, test } from '@playwright/test';
import { fresh, loadSample } from './helpers';

test('several trips live on the device without an account (#12)', async ({ page }) => {
  await fresh(page);
  await page.goto('/trips');
  await page.getByLabel('New trip on this device').fill('Elsass');
  await page.getByRole('button', { name: 'New trip on this device' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/trips');
  await page.getByLabel('New trip on this device').fill('Norwegen');
  await page.getByRole('button', { name: 'New trip on this device' }).click();

  await page.goto('/trips');
  for (const name of ['Elsass', 'Norwegen']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  // No sign-in anywhere in that flow.
  await expect(page.getByText('Sign in to create or join shared trips.')).toBeVisible();
});

test('deleting the open trip lands on the trip list, not on another trip (#12)', async ({ page }) => {
  await loadSample(page);
  await page.goto('/trip/settings');
  page.once('dialog', (d) => { void d.accept(); });
  await page.getByRole('button', { name: 'Delete this trip' }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByText('Elsass 2026', { exact: true })).toHaveCount(0);
});

test('a trip-scoped screen redirects to the list when no trip is open (#12)', async ({ page }) => {
  // Clearing storage does not get you here: the initial state always carries a
  // starter trip. The only way to have none open is to delete the one you are
  // in — after which the guard has to hold for a deep link or a back button,
  // not just for the redirect that follows the delete.
  await loadSample(page);
  await page.goto('/trip/settings');
  page.once('dialog', (d) => { void d.accept(); });
  await page.getByRole('button', { name: 'Delete this trip' }).click();
  await expect(page).toHaveURL(/\/trips$/);

  await page.goto('/trip/settings');
  await expect(page).toHaveURL(/\/trips$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/trips$/);
});
