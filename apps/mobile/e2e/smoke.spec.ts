import { expect, test } from '@playwright/test';
import { expectBalancesSumToZero, fresh, loadSample } from './helpers';

test('a fresh install asks for people, and the ask leads somewhere (#4, #11)', async ({ page }) => {
  await fresh(page);
  // The old empty state asked for an expense that could not be saved, because
  // the form has no payer to offer until somebody exists.
  await expect(page.getByText('Add the people you are splitting with — they need no account.')).toBeVisible();
  await page.getByRole('button', { name: 'Add people' }).click();
  await expect(page).toHaveURL(/\/trip\/participants$/);
});

test('app-level destinations are not buried in a card header (#6)', async ({ page }) => {
  await loadSample(page);
  // "Trips" and "Settings" used to sit in the Recent entries heading row; they
  // are header actions now. Role is `link`, not `button`: expo-router's Link
  // renders an anchor on web and the anchor's role wins over the Pressable's.
  await expect(page.getByRole('link', { name: 'Trips' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Trip settings' })).toBeVisible();
  await page.getByRole('link', { name: 'Trip settings' }).click();
  await expect(page).toHaveURL(/\/trip\/settings$/);
  await expect(page.getByText('These apply to this trip only.')).toBeVisible();
});

test('sample trip: headline, balances and trip cost', async ({ page }) => {
  await loadSample(page);
  await expect(page.getByText('You owe €128.92')).toBeVisible(); // exact −128.916, see §5.1
  await expect(page.getByText('€945.48')).toBeVisible();
  await expect(page.getByRole('button', { name: /Robert.*gets back €350.65/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Marc.*gets back €141.90/ })).toBeVisible();
  await expectBalancesSumToZero(page);
});

test('data survives a reload (local persistence)', async ({ page }) => {
  await loadSample(page);
  await page.reload();
  await expect(page.getByText('You owe €128.92')).toBeVisible();
});

test('language switch changes the UI to German', async ({ page }) => {
  await loadSample(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'DE', exact: true }).click();
  await expect(page.getByText('Beispielreise laden')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Du schuldest 128,92 €')).toBeVisible();
});

test('the add button stays put when the overview scrolls (#5)', async ({ page }) => {
  await loadSample(page);
  // A short viewport rather than a long trip: this has to overflow by a lot
  // whatever the sample happens to contain, or the assertion below proves
  // nothing. It used to be that the button, positioned absolutely *inside* the
  // scroll view, slid up out of reach with the content.
  await page.setViewportSize({ width: 390, height: 420 });
  const fab = page.getByRole('button', { name: 'Add entry' });
  const before = await fab.boundingBox();
  const scrolled = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div'));
    const el = divs.find((d) => d.scrollHeight > d.clientHeight + 5 && getComputedStyle(d).overflowY === 'auto');
    if (!el) return 0;
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(scrolled, 'the overview has to actually scroll or this proves nothing').toBeGreaterThan(50);
  expect(await fab.boundingBox()).toEqual(before);
});

test('one entry point, and it lets you choose what you are adding (#15)', async ({ page }) => {
  await loadSample(page);
  // There used to be a "Record payment" link next to the + as well.
  await expect(page.getByRole('link', { name: 'Record payment' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add entry' }).click();
  for (const kind of ['Expense', 'Payment', 'Adjustment']) {
    await expect(page.getByRole('button', { name: kind, exact: true })).toBeVisible();
  }
});
