import { type Browser, type Page, expect, test } from '@playwright/test';

const API = 'http://localhost:8090';

/** Sign in through the real magic-link flow, reading the link from the dev API instead of an inbox. */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto('/signin');
  await page.getByLabel('E-mail address').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  await expect(page.getByText(/Check your inbox/)).toBeVisible();
  const res = await page.request.get(`${API}/dev/magic-links`);
  const { links } = (await res.json()) as { links: { to: string; url: string }[] };
  const mine = [...links].reverse().find((l) => l.to === email)!;
  const token = new URL(mine.url).searchParams.get('token')!;
  await page.goto(`/auth/email?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/trips$/);
  await expect(page.getByText(/No shared trips yet|Open/).first()).toBeVisible();
}

async function newUser(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await signIn(page, email);
  return page;
}

test('two people share one trip through the API: invite, claim, add expense, see it on the other phone', async ({ browser }) => {
  const robert = await newUser(browser, `robert-${Date.now()}@t.de`);

  // Robert creates a shared trip
  await robert.getByLabel('Trip name').fill('Elsass shared');
  await robert.getByRole('button', { name: 'New shared trip' }).click();
  await expect(robert.getByRole('heading', { name: 'Elsass shared' })).toBeVisible();
  await expect(robert.getByText(/Synced|Not synced yet|waiting to sync/)).toBeVisible();

  // He adds Max as a placeholder and creates an invite link
  await robert.goto('/trip/participants');
  await robert.getByLabel('Name').fill('Max');
  await robert.getByRole('button', { name: 'OK' }).click();
  await expect(robert.getByText('Max')).toBeVisible();
  await robert.goto('/trip/settings');
  await robert.getByRole('button', { name: 'Create invite link' }).click();
  const inviteUrl = (await robert.getByText(/\/i\//).innerText()).trim();
  expect(inviteUrl).toMatch(/^http:\/\/localhost:8787\/i\//);

  // Robert logs an expense paid by him, split with Max
  await robert.goto('/entry/new');
  await robert.getByLabel('Amount').first().fill('30');
  await robert.getByLabel('Description').first().fill('Fuel');
  await robert.getByRole('button', { name: 'Save' }).click();
  await expect(robert.getByText('Fuel')).toBeVisible();
  await expect(robert.getByText('Synced')).toBeVisible({ timeout: 15_000 });

  // Max opens the invite on another phone: signs in, claims "Max", lands in the trip
  const max = await newUser(browser, `max-${Date.now()}@t.de`);
  await max.goto(inviteUrl);
  await expect(max.getByText('Who are you in this trip?')).toBeVisible();
  await max.getByRole('button', { name: 'Max', exact: true }).click();
  await max.getByRole('button', { name: 'Join' }).click();
  await expect(max.getByRole('heading', { name: 'Elsass shared' })).toBeVisible();
  await expect(max.getByText('You owe €15.00')).toBeVisible({ timeout: 15_000 });
  await expect(max.getByText('Fuel')).toBeVisible();

  // Max pays; Robert's phone sees it within the poll interval
  await max.goto('/settle');
  await max.getByRole('button', { name: 'Mark paid' }).first().click();
  await expect(max.getByText('Everyone is settled.')).toBeVisible();
  await robert.goto('/');
  await expect(robert.getByText('You are settled')).toBeVisible({ timeout: 20_000 });

  // The server agrees with both phones
  const token = await robert.evaluate(() => JSON.parse(localStorage.getItem('trip-ledger:v1') ?? '{}').state?.auth?.token as string);
  const trips = await (await robert.request.get(`${API}/trips`, { headers: { authorization: `Bearer ${token}` } })).json() as { trips: { id: string }[] };
  const bal = await (await robert.request.get(`${API}/trips/${trips.trips[0]!.id}/balances`, { headers: { authorization: `Bearer ${token}` } })).json() as { shown: Record<string, string>; invariants: { ok: boolean } };
  expect(Object.values(bal.shown).every((v) => v === '0.00')).toBe(true);
  expect(bal.invariants.ok).toBe(true);
});

test('an invite opened before sign-in is resumed after sign-in', async ({ browser }) => {
  const owner = await newUser(browser, `owner-${Date.now()}@t.de`);
  await owner.getByLabel('Trip name').fill('Late joiner');
  await owner.getByRole('button', { name: 'New shared trip' }).click();
  await expect(owner.getByRole('heading', { name: 'Late joiner' })).toBeVisible();
  await owner.goto('/trip/settings');
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const inviteUrl = (await owner.getByText(/\/i\//).innerText()).trim();

  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 412, height: 915 } });
  const late = await ctx.newPage();
  await late.goto(inviteUrl);
  await expect(late).toHaveURL(/\/signin$/);
  const email = `late-${Date.now()}@t.de`;
  await late.getByLabel('E-mail address').fill(email);
  await late.getByRole('button', { name: 'Send sign-in link' }).click();
  const { links } = (await (await late.request.get(`${API}/dev/magic-links`)).json()) as { links: { to: string; url: string }[] };
  const token = new URL([...links].reverse().find((l) => l.to === email)!.url).searchParams.get('token')!;
  await late.goto(`/auth/email?token=${encodeURIComponent(token)}`);
  await expect(late.getByText('Who are you in this trip?')).toBeVisible();
  await late.getByLabel('Your name').fill('Lena');
  await late.getByRole('button', { name: 'Join' }).click();
  await expect(late.getByRole('heading', { name: 'Late joiner' })).toBeVisible();
  await expect(late.getByRole('button', { name: /Lena/ })).toBeVisible();
});

test('the entry history says who changed what, on a shared trip (FR-10.2)', async ({ browser }) => {
  const robert = await newUser(browser, `hist-${Date.now()}@t.de`);
  await robert.getByLabel('Trip name').fill('Verlauf');
  await robert.getByRole('button', { name: 'New shared trip' }).click();
  await expect(robert.getByRole('heading', { name: 'Verlauf' })).toBeVisible();

  // A fresh entry has only its creation to show.
  await robert.goto('/entry/new');
  await robert.getByLabel('Amount').first().fill('30');
  await robert.getByLabel('Description').first().fill('Tanken');
  await robert.getByRole('button', { name: 'Save' }).click();
  await expect(robert.getByText('Synced')).toBeVisible({ timeout: 20_000 });
  await robert.goto('/ledger');
  await robert.getByText('Tanken').first().click();
  await expect(robert.getByText(/^Created by /)).toBeVisible({ timeout: 15_000 });
  await expect(robert.getByText(/^Changed by /)).toHaveCount(0);

  // Edit it: the amount and the description both land in the trail.
  await robert.getByRole('button', { name: 'Edit entry' }).click();
  await robert.getByLabel('Amount').first().fill('42');
  await robert.getByLabel('Description').first().fill('Tanken Samstag');
  await robert.getByRole('button', { name: 'Save' }).click();
  // Saving an edit returns to the entry, which carries no sync banner; the home screen does.
  await robert.goto('/');
  await expect(robert.getByText('Synced')).toBeVisible({ timeout: 20_000 });
  await robert.goto('/ledger');
  await robert.getByText('Tanken Samstag').first().click();

  await expect(robert.getByText(/^Changed by /).first()).toBeVisible({ timeout: 15_000 });
  await expect(robert.getByText('Amount: €30.00 → €42.00')).toBeVisible();
  await expect(robert.getByText('Description: “Tanken” → “Tanken Samstag”')).toBeVisible();
  // The creation stays at the bottom of the trail.
  await expect(robert.getByText(/^Created by /)).toBeVisible();

  // Deleting is a change like any other, and reads as one.
  robert.once('dialog', (d) => { void d.accept(); });
  await robert.getByRole('button', { name: 'Delete', exact: true }).click();
  await robert.goto('/');
  await expect(robert.getByText('Synced')).toBeVisible({ timeout: 20_000 });
  await robert.goto('/ledger');
  await robert.getByRole('button', { name: /Show deleted/ }).click();
  await robert.getByText('Tanken Samstag').first().click();
  await expect(robert.getByText('Deleted', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test('the recipient disputes a payment; both phones see it and the balances do not move (FR-5.3)', async ({ browser }) => {
  // The trip creator's participant is named after their sign-in address, not "Robert".
  const robertEmail = `disp-r-${Date.now()}@t.de`;
  const robertName = robertEmail.split('@')[0]!;
  const robert = await newUser(browser, robertEmail);
  await robert.getByLabel('Trip name').fill('Streitfall');
  await robert.getByRole('button', { name: 'New shared trip' }).click();
  await expect(robert.getByRole('heading', { name: 'Streitfall' })).toBeVisible();

  await robert.goto('/trip/participants');
  await robert.getByLabel('Name').fill('Max');
  await robert.getByRole('button', { name: 'OK' }).click();
  await robert.goto('/trip/settings');
  await robert.getByRole('button', { name: 'Create invite link' }).click();
  const inviteUrl = (await robert.getByText(/\/i\//).innerText()).trim();

  await robert.goto('/entry/new');
  await robert.getByLabel('Amount').first().fill('40');
  await robert.getByLabel('Description').first().fill('Tanken');
  await robert.getByRole('button', { name: 'Save' }).click();
  await expect(robert.getByText('Synced')).toBeVisible({ timeout: 20_000 });

  const max = await newUser(browser, `disp-m-${Date.now()}@t.de`);
  await max.goto(inviteUrl);
  await max.getByRole('button', { name: 'Max', exact: true }).click();
  await max.getByRole('button', { name: 'Join' }).click();
  await expect(max.getByRole('heading', { name: 'Streitfall' })).toBeVisible();
  await expect(max.getByText('You owe €20.00')).toBeVisible({ timeout: 20_000 });

  // Max claims he paid it back.
  await max.goto('/entry/new?kind=transfer');
  await max.getByLabel('Amount').first().fill('20');
  await max.getByLabel('Description').first().fill('Rueckzahlung');
  await max.getByRole('button', { name: robertName, exact: true }).nth(1).click();   // the "to" row
  await max.getByRole('button', { name: 'Save' }).click();
  await max.goto('/');
  await expect(max.getByText('Synced')).toBeVisible({ timeout: 20_000 });

  await robert.goto('/');
  await expect(robert.getByText('You are settled')).toBeVisible({ timeout: 25_000 });
  const settled = await robert.getByRole('button', { name: /owes €|gets back €|settled/ }).allInnerTexts();

  // Robert never saw that money arrive.
  await robert.goto('/ledger');
  await robert.getByText('Rueckzahlung').first().click();
  await robert.getByRole('button', { name: 'Dispute this payment' }).click();
  await robert.getByLabel('Reason', { exact: true }).fill('nie angekommen');
  await robert.getByRole('button', { name: 'Dispute', exact: true }).click();
  await expect(robert.getByText(new RegExp(`^Disputed by ${robertName}`))).toBeVisible();

  // The flag moves no money: the balances are the ones he already had.
  await robert.goto('/');
  await expect(robert.getByText('Synced')).toBeVisible({ timeout: 20_000 });
  expect(await robert.getByRole('button', { name: /owes €|gets back €|settled/ }).allInnerTexts()).toEqual(settled);
  await expect(robert.getByText('⚠︎ disputed').first()).toBeVisible();

  // Max — the sender — sees it, and is not offered a way to clear it.
  await max.goto('/ledger');
  await expect(max.getByText('⚠︎ disputed').first()).toBeVisible({ timeout: 25_000 });
  await max.getByText('Rueckzahlung').first().click();
  await expect(max.getByText(new RegExp(`^Disputed by ${robertName}`))).toBeVisible();
  await expect(max.getByRole('button', { name: 'Withdraw dispute' })).toHaveCount(0);

  // Robert takes it back.
  await robert.goto('/ledger');
  await robert.getByText('Rueckzahlung').first().click();
  await robert.getByRole('button', { name: 'Withdraw dispute' }).click();
  await expect(robert.getByText(/^Disputed by/)).toHaveCount(0);
});

test('a joiner names themselves, an admin corrects a name, and the old ones stay visible (FR-1.12)', async ({ browser }) => {
  const ownerEmail = `nm-o-${Date.now()}@t.de`;
  const ownerName = ownerEmail.split('@')[0]!;
  const owner = await newUser(browser, ownerEmail);
  await owner.getByLabel('Trip name').fill('Namen');
  await owner.getByRole('button', { name: 'New shared trip' }).click();
  await expect(owner.getByRole('heading', { name: 'Namen' })).toBeVisible();

  // The creator is named after their sign-in address until someone fixes it.
  await owner.goto('/trip/participants');
  await expect(owner.getByText(`${ownerName} (you)`)).toBeVisible();

  await owner.getByLabel('Name').fill('Mx');
  await owner.getByRole('button', { name: 'OK' }).click();
  await owner.goto('/trip/settings');
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const inviteUrl = (await owner.getByText(/\/i\//).innerText()).trim();

  // Joining: the placeholder's name is offered, and the person it turned out to be corrects it.
  const max = await newUser(browser, `nm-m-${Date.now()}@t.de`);
  await max.goto(inviteUrl);
  await max.getByRole('button', { name: 'Mx', exact: true }).click();
  await expect(max.getByText('Your name in this trip')).toBeVisible();
  await max.getByLabel('Your name').fill('Max');
  await max.getByRole('button', { name: 'Join' }).click();
  await expect(max.getByRole('heading', { name: 'Namen' })).toBeVisible();

  await max.goto('/trip/participants');
  await expect(max.getByText(/^Max \(you\)/)).toBeVisible();
  await expect(max.getByText(/Formerly: Mx/)).toBeVisible();

  // A member may rename themselves but is offered nothing for anyone else.
  expect(await max.getByRole('button', { name: 'Rename' }).count()).toBe(1);

  // The owner is an admin: they can rename themselves and everyone else.
  await owner.goto('/trip/participants');
  await expect(owner.getByText(/^Max/)).toBeVisible({ timeout: 25_000 });
  expect(await owner.getByRole('button', { name: 'Rename' }).count()).toBe(2);
  await owner.getByRole('button', { name: 'Rename' }).first().click();
  await owner.getByLabel('Rename').fill('Robert');
  await owner.getByRole('button', { name: 'Save' }).click();
  await expect(owner.getByText(/^Robert \(you\)/)).toBeVisible();
  await expect(owner.getByText(`Formerly: ${ownerName}`)).toBeVisible({ timeout: 20_000 });

  // The rename reaches the other phone, and the ledger still adds up.
  await max.goto('/trip/participants');
  await expect(max.getByText(/^Robert/)).toBeVisible({ timeout: 25_000 });
});
