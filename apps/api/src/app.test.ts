import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hono } from 'hono';
import { type ParticipantId, allocate, currency, entryToWire, localDate, money, toPrecise } from '@vst/domain';
import { type Connection } from '@vst/persistence';
import { testConnection } from '@vst/persistence/testing';
import { type AppDeps, createApp, createMetricsApp } from './app.ts';
import { MemoryRateLimiter } from './identity/rate-limit.ts';
import { sessionService } from './identity/sessions.ts';
import { type IdentityVerifier, IdentityError, type Provider, type VerifiedIdentity } from './identity/verifier.ts';
import { promMetrics } from './metrics.ts';
import { fixedClock } from './ports/clock.ts';
import { RecordingNotifier } from './ports/notifier.ts';

/** Tokens look like "google|sub|email" — the real verifier is covered in identity.test.ts. */
class FakeVerifier implements IdentityVerifier {
  verify(provider: Provider, token: string): Promise<VerifiedIdentity> {
    const [p, subject, email] = token.split('|');
    if (p !== provider || !subject) return Promise.reject(new IdentityError('INVALID_TOKEN', 'fake'));
    return Promise.resolve({ provider, subject, ...(email ? { email } : {}) });
  }
}

let conn: Connection; let app: Hono; let metricsApp: Hono; let notifier: RecordingNotifier;
const clock = fixedClock('2026-09-08T10:00:00Z');
const EUR = currency('EUR');

beforeAll(async () => {
  conn = await testConnection();
  notifier = new RecordingNotifier();
  const metrics = promMetrics();
  const sessions = sessionService(conn.db, clock);
  const verifier = new FakeVerifier();
  const limiter = new MemoryRateLimiter(100, 60_000, () => clock.nowMs());
  const deps: AppDeps = {
    db: conn.db, sessions, verifier, notifier, clock, limiter, metrics, appBaseUrl: 'https://app.test',
    signInDeps: () => ({ db: conn.db, verifier, sessions, notifier, clock, limiter, appBaseUrl: 'https://app.test', t: (_k, v) => v.url }),
  };
  app = createApp(deps);
  metricsApp = createMetricsApp(metrics, 'secret');
});
afterAll(async () => { await conn.close(); });

// ---------------------------------------------------------------- helpers
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function call(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await app.request(path, { ...rest, headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function signIn(sub: string, email?: string): Promise<{ token: string; userId: string }> {
  const r = await call('/auth/google', json({ token: `google|${sub}|${email ?? ''}` }));
  expect(r.status).toBe(200);
  return { token: r.body.token, userId: r.body.userId };
}
async function newTrip(token: string, name = 'Elsass'): Promise<{ tripId: string; me: string }> {
  const id = crypto.randomUUID();
  const r = await call('/trips', { ...json({ id, name, baseCcy: 'EUR' }), token });
  expect(r.status).toBe(201);
  const t = await call(`/trips/${id}`, { token });
  return { tripId: id, me: t.body.participants[0].id };
}
async function addPlaceholder(token: string, tripId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  const r = await call(`/trips/${tripId}/participants`, { ...json({ id, displayName: name }), token });
  expect(r.status).toBe(201);
  return id;
}
function expenseWire(amountMinor: bigint, payer: string, among: string[], extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID(); const m = money(amountMinor, EUR);
  return { ...entryToWire({ id, type: 'expense', description: 'x', amount: m, date: localDate('2026-09-01'), payments: [{ participantId: payer as ParticipantId, amount: m }], shares: allocate(m, { kind: 'equal', among: among as ParticipantId[] }, { seed: id }), createdAt: '2026-09-01T10:00:00.000Z' }), ...extra };
}

// ---------------------------------------------------------------- tests
describe('auth', () => {
  it('signs in, reads /me, logs out', async () => {
    const { token, userId } = await signIn('u1', 'u1@t.de');
    const me = await call('/me', { token });
    expect(me.status).toBe(200); expect(me.body).toMatchObject({ id: userId, email: 'u1@t.de' });
    expect((await call('/me')).status).toBe(401);
    expect((await call('/auth/logout', { method: 'POST', token })).status).toBe(204);
    expect((await call('/me', { token })).status).toBe(401);
  });
  it('rejects a bad provider token with 401', async () => {
    expect((await call('/auth/apple', json({ token: 'google|user-x|' }))).status).toBe(401);
  });
  it('magic link end to end', async () => {
    expect((await call('/auth/email/request', json({ email: 'ml@t.de' }))).status).toBe(204);
    const url = notifier.emails.at(-1)!.text;
    const token = new URL(url).searchParams.get('token')!;
    const v = await call('/auth/email/verify', json({ token }));
    expect(v.status).toBe(200); expect(v.body.isNewUser).toBe(true);
    expect((await call('/auth/email/verify', json({ token }))).status).toBe(401);
  });
  it('validates bodies', async () => {
    expect((await call('/auth/google', json({ nope: 1 }))).status).toBe(400);
  });
});

describe('trips, invites, participants', () => {
  it('creating a trip makes the creator admin and a claimed participant', async () => {
    const { token, userId } = await signIn('t1', 'robert@t.de');
    const { tripId } = await newTrip(token);
    const t = await call(`/trips/${tripId}`, { token });
    expect(t.body.me).toEqual({ userId, role: 'admin' });
    expect(t.body.participants).toHaveLength(1);
    expect(t.body.participants[0].userId).toBe(userId);
    expect(t.body.participants[0].displayName).toBe('robert');
    expect((await call('/trips', { token })).body.trips.map((x: { id: string }) => x.id)).toContain(tripId);
  });

  it('other users get 404 for a trip they are not in; invites admit them; placeholders can be claimed', async () => {
    const a = await signIn('t2a'); const b = await signIn('t2b');
    const { tripId } = await newTrip(a.token);
    expect((await call(`/trips/${tripId}`, { token: b.token })).status).toBe(404);
    const lena = await addPlaceholder(a.token, tripId, 'Lena');
    const inv = await call(`/trips/${tripId}/invites`, { method: 'POST', token: a.token });
    expect(inv.status).toBe(201);
    const invToken = inv.body.url.split('/i/')[1];
    expect((await call(`/invites/${invToken}/accept`, { method: 'POST' })).status).toBe(401); // never before sign-in
    const acc = await call(`/invites/${invToken}/accept`, { method: 'POST', token: b.token });
    expect(acc.status).toBe(200);
    expect(acc.body.unclaimed).toEqual([{ id: lena, displayName: 'Lena' }]);
    const claim = await call(`/trips/${tripId}/participants/${lena}/claim`, { method: 'POST', token: b.token });
    expect(claim.status).toBe(200); expect(claim.body.userId).toBe(b.userId);
    expect((await call(`/trips/${tripId}`, { token: b.token })).body.me.role).toBe('member');
    // revoked invites stop working
    expect((await call(`/trips/${tripId}/invites`, { method: 'DELETE', token: b.token })).status).toBe(403); // not admin
    expect((await call(`/trips/${tripId}/invites`, { method: 'DELETE', token: a.token })).status).toBe(204);
    expect((await call(`/invites/${invToken}/accept`, { method: 'POST', token: (await signIn('t2c')).token })).status).toBe(404);
  });
});

describe('ledger', () => {
  it('create, feed, update with If-Match, conflict, delete, restore — with server-side balances agreeing', async () => {
    const { token } = await signIn('l1');
    const { tripId, me } = await newTrip(token);
    const max = await addPlaceholder(token, tripId, 'Max');
    const w = expenseWire(5518n, me, [me, max], { category: 'groceries' });
    const created = await call(`/trips/${tripId}/entries`, { ...json(w), token });
    expect(created.status).toBe(201); expect(created.body.version).toBe(1);
    expect(created.body.shares.map((s: { amount: string }) => s.amount)).toEqual(['27.59000000', '27.59000000']);
    // idempotent retry of the same create returns 200 with the row
    expect((await call(`/trips/${tripId}/entries`, { ...json(w), token })).status).toBe(200);
    // a different entry with the same id is a 409
    expect((await call(`/trips/${tripId}/entries`, { ...json({ ...w, description: 'other' }), token })).status).toBe(409);

    const feed0 = await call(`/trips/${tripId}/entries?since=0`, { token });
    expect(feed0.body.entries.map((e: { id: string }) => e.id)).toEqual([w.id]);
    expect(feed0.body.participants).toHaveLength(2);
    expect(feed0.body.trip).not.toBeNull();
    const cursor = feed0.body.seq;
    expect((await call(`/trips/${tripId}/entries?since=${cursor}`, { token })).body.entries).toEqual([]);

    expect((await call(`/trips/${tripId}/entries/${w.id}`, { ...json({ ...w, description: 'renamed' }), method: 'PATCH', token })).status).toBe(428);
    const upd = await call(`/trips/${tripId}/entries/${w.id}`, { ...json({ ...w, description: 'renamed' }, { 'if-match': '1' }), method: 'PATCH', token });
    expect(upd.status).toBe(200); expect(upd.body.version).toBe(2);
    const stale = await call(`/trips/${tripId}/entries/${w.id}`, { ...json({ ...w, description: 'stale' }, { 'if-match': '1' }), method: 'PATCH', token });
    expect(stale.status).toBe(409); expect(stale.body.error.current.description).toBe('renamed');

    const bal = await call(`/trips/${tripId}/balances`, { token });
    expect(bal.body.shown[me]).toBe('27.59'); expect(bal.body.shown[max]).toBe('-27.59'); expect(bal.body.cost).toBe('55.18'); expect(bal.body.invariants.ok).toBe(true);

    const del = await call(`/trips/${tripId}/entries/${w.id}`, { method: 'DELETE', headers: { 'if-match': '2' }, token });
    expect(del.status).toBe(200); expect(del.body.deleted).toBe(true);
    expect((await call(`/trips/${tripId}/balances`, { token })).body.cost).toBe('0.00');
    const feed1 = await call(`/trips/${tripId}/entries?since=${cursor}`, { token });
    expect(feed1.body.entries.map((e: { id: string; deleted?: boolean }) => [e.id, e.deleted])).toEqual([[w.id, true]]);
    expect((await call(`/trips/${tripId}/entries/${w.id}/restore`, { method: 'POST', headers: { 'if-match': '3' }, token })).body.deleted).toBeUndefined();
  });

  it('rejects an entry that does not reconcile (422) and one referencing another trip\'s participant', async () => {
    const { token } = await signIn('l2');
    const { tripId, me } = await newTrip(token);
    const w = expenseWire(1000n, me, [me]);
    const bad = { ...w, shares: [{ participantId: me, amount: '9.99000000' }] };
    const r = await call(`/trips/${tripId}/entries`, { ...json(bad), token });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('INVARIANT_VIOLATION');
    const other = await newTrip(token, 'other');
    const foreign = expenseWire(1000n, other.me, [other.me]);
    expect((await call(`/trips/${tripId}/entries`, { ...json(foreign), token })).status).toBe(422);
  });

  it('settlement plans and share settlement', async () => {
    const { token } = await signIn('l3');
    const { tripId, me } = await newTrip(token);
    const max = await addPlaceholder(token, tripId, 'Max'); const marc = await addPlaceholder(token, tripId, 'Marc');
    await call(`/trips/${tripId}/entries`, { ...json(expenseWire(3000n, me, [me, max, marc])), token });
    await call(`/trips/${tripId}/entries`, { ...json(expenseWire(1500n, marc, [me, max, marc])), token });
    const opt = await call(`/trips/${tripId}/settlement?plan=optimal`, { token });
    expect(opt.status).toBe(200); expect(opt.body.minimal).toBe(true);
    expect(opt.body.transfers).toEqual([{ from: max, to: me, amount: '15.00' }]);
    const hub = await call(`/trips/${tripId}/settlement?plan=hub&hub=${marc}`, { token });
    expect(hub.body.transfers.every((t: { from: string; to: string }) => t.from === marc || t.to === marc)).toBe(true);
    expect((await call(`/trips/${tripId}/settlement?plan=bilateral`, { token })).status).toBe(200);
    // pay it and link the share
    const t = money(1500n, EUR);
    const transfer = entryToWire({ id: crypto.randomUUID(), type: 'transfer', description: 'pay', amount: t, date: localDate('2026-09-02'), payments: [{ participantId: max as ParticipantId, amount: t }], shares: [{ participantId: me as ParticipantId, amount: toPrecise(t) }], createdAt: '2026-09-02T00:00:00.000Z' });
    expect((await call(`/trips/${tripId}/entries`, { ...json(transfer), token })).status).toBe(201);
    expect((await call(`/trips/${tripId}/settlement`, { token })).body.transfers).toEqual([]);
  });

  it('lifecycle: freeze blocks expenses, close needs zero balances, closed is read-only', async () => {
    const { token } = await signIn('l4');
    const { tripId, me } = await newTrip(token);
    const max = await addPlaceholder(token, tripId, 'Max');
    await call(`/trips/${tripId}/entries`, { ...json(expenseWire(2000n, me, [me, max])), token });
    expect((await call(`/trips/${tripId}/transition`, { ...json({ action: 'freeze' }), token })).body.status).toBe('settling');
    expect((await call(`/trips/${tripId}/entries`, { ...json(expenseWire(100n, me, [me, max])), token })).status).toBe(409);
    expect((await call(`/trips/${tripId}/transition`, { ...json({ action: 'close' }), token })).status).toBe(409);
    const t = money(1000n, EUR);
    const pay = entryToWire({ id: crypto.randomUUID(), type: 'transfer', description: 'pay', amount: t, date: localDate('2026-09-02'), payments: [{ participantId: max as ParticipantId, amount: t }], shares: [{ participantId: me as ParticipantId, amount: toPrecise(t) }], createdAt: '2026-09-02T00:00:00.000Z' });
    expect((await call(`/trips/${tripId}/entries`, { ...json(pay), token })).status).toBe(201);
    expect((await call(`/trips/${tripId}/transition`, { ...json({ action: 'close' }), token })).body.status).toBe('closed');
    expect((await call(`/trips/${tripId}/entries`, { ...json(pay), token })).status).toBe(200); // identical re-send: idempotent, no write
    expect((await call(`/trips/${tripId}/entries`, { ...json({ ...pay, id: crypto.randomUUID() }), token })).status).toBe(409); // a real write is refused
    expect((await call(`/trips/${tripId}/transition`, { ...json({ action: 'reopen' }), token })).body.status).toBe('open');
  });
});

describe('account deletion', () => {
  it('leaves the trip and its balances intact for the others', async () => {
    const a = await signIn('d1', 'a@t.de'); const b = await signIn('d2', 'b@t.de');
    const { tripId, me } = await newTrip(a.token);
    const inv = (await call(`/trips/${tripId}/invites`, { method: 'POST', token: a.token })).body.url.split('/i/')[1];
    await call(`/invites/${inv}/accept`, { method: 'POST', token: b.token });
    const pb = await addPlaceholder(a.token, tripId, 'B');
    await call(`/trips/${tripId}/participants/${pb}/claim`, { method: 'POST', token: b.token });
    await call(`/trips/${tripId}/entries`, { ...json(expenseWire(4000n, pb, [me, pb])), token: a.token });
    const before = (await call(`/trips/${tripId}/balances`, { token: b.token })).body.shown;
    expect((await call('/me', { method: 'DELETE', token: b.token })).status).toBe(204);
    expect((await call('/me', { token: b.token })).status).toBe(401);
    const after = await call(`/trips/${tripId}/balances`, { token: a.token });
    expect(after.body.shown).toEqual(before);
    const t = await call(`/trips/${tripId}`, { token: a.token });
    expect(t.body.participants.find((p: { id: string }) => p.id === pb)).toMatchObject({ userId: null, displayName: 'B' });
    expect(t.body.members).toHaveLength(1);
  });
});

describe('metrics', () => {
  it('are exposed on the internal app behind a bearer token, with RED and business counters', async () => {
    expect((await metricsApp.request('/metrics')).status).toBe(401);
    const res = await metricsApp.request('/metrics', { headers: { authorization: 'Bearer secret' } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/vst_http_requests_total\{route="\/trips\/:tripId\/entries",method="POST",status="201"\}/);
    expect(text).toMatch(/vst_entry_writes_total\{type="expense",op="create"\}/);
    expect(text).toMatch(/vst_settlement_plans_total\{kind="optimal",search="exact"\}/);
    expect(text).toMatch(/vst_write_conflicts_total/);
    expect(text).toMatch(/vst_trip_scope_denied_total \d+/);
    expect(text).toMatch(/vst_account_deletions_total 1/);
  });
});
