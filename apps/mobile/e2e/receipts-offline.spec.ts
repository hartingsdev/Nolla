import { expect, test } from '@playwright/test';
import { type Browser, type Page } from '@playwright/test';

const API = 'http://localhost:8090';

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto('/signin');
  await page.getByLabel('E-mail address').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  const { links } = (await (await page.request.get(`${API}/dev/magic-links`)).json()) as { links: { to: string; url: string }[] };
  const token = new URL([...links].reverse().find((l) => l.to === email)!.url).searchParams.get('token')!;
  await page.goto(`/auth/email?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/trips$/);
}

async function sharedTrip(browser: Browser, email: string, name: string): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await signIn(page, email);
  await page.getByLabel('Trip name').fill(name);
  await page.getByRole('button', { name: 'New shared trip' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  return page;
}

test('a receipt is uploaded from the browser and shown on the entry', async ({ browser }) => {
  const page = await sharedTrip(browser, `receipt-${Date.now()}@t.de`, 'Receipt trip');
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill('42');
  await page.getByLabel('Description').first().fill('Dinner');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });

  await page.goto('/ledger');
  await page.getByText('Dinner').first().click();
  await expect(page.getByText('Receipts', { exact: true })).toBeVisible();

  // a 1x1 PNG stands in for a photo; the file chooser is the same code path as the camera
  // setFiles needs a Node Buffer, not a Uint8Array
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose from library' }).click();
  await (await chooser).setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });

  await expect(page.getByText('1 receipt')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Receipts are kept for 365 days/)).toBeVisible();

  // the thumbnail really loads from the presigned URL rather than showing broken
  const img = page.locator('img[src*="/blobs/"], img[srcset*="/blobs/"]').first();
  await expect(img).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
});

test('offline: entries are queued, shown as queued, and replay when the network returns', async ({ browser }) => {
  const page = await sharedTrip(browser, `offline-${Date.now()}@t.de`, 'Offline trip');
  await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });

  // cut the API off at the network layer: the app keeps working, writes pile up locally
  await page.route(`${API}/**`, (route) => route.abort('failed'));
  await page.goto('/entry/new');
  await page.getByLabel('Amount').first().fill('12');
  await page.getByLabel('Description').first().fill('Kiosk offline');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Kiosk offline')).toBeVisible();
  await expect(page.getByText(/Offline|waiting to sync/).first()).toBeVisible({ timeout: 15_000 });

  await page.goto('/ledger');
  await expect(page.getByText(/Queued ·/)).toBeVisible();

  // a second edit while still offline folds into the same pending write
  await page.getByText('Kiosk offline').first().click();
  await page.getByRole('button', { name: 'Edit entry' }).click();
  await page.getByLabel('Description').first().fill('Kiosk (offline, edited)');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.goto('/ledger');
  await expect(page.getByText('Kiosk (offline, edited)')).toBeVisible();
  await expect(page.getByText(/Queued ·/)).toBeVisible();   // still one pending write, not two

  // network back: the queue drains and the server has the final text
  await page.unroute(`${API}/**`);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Synced')).toBeVisible({ timeout: 20_000 });
  await page.goto('/ledger');
  await expect(page.getByText(/Queued ·/)).toHaveCount(0);

  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('trip-ledger:v1') ?? '{}').state?.auth?.token as string);
  const { trips } = await (await page.request.get(`${API}/trips`, { headers: { authorization: `Bearer ${token}` } })).json() as { trips: { id: string }[] };
  const feed = await (await page.request.get(`${API}/trips/${trips[0]!.id}/entries?since=0`, { headers: { authorization: `Bearer ${token}` } })).json() as { entries: { description: string }[] };
  expect(feed.entries.map((e) => e.description)).toContain('Kiosk (offline, edited)');
  expect(feed.entries).toHaveLength(1); // one entry, not a create plus an edit
});
