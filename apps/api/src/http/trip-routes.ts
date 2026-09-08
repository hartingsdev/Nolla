import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  addParticipant, changesQuery, createTrip, patchTrip, settleShare, settlementQuery, transition as transitionBody, wireEntry,
} from '@vst/contracts';
import {
  type Balances, type ParticipantId, type PlanOptions, balances, currency, entryFromWire, grossMatrix, moneyToString, preciseToString,
  roundAll, settle, transition, tripCost, zeroMoney,
} from '@vst/domain';
import { ConflictError, checkInvariants, entryRepo, participantRepo, schema, tripRepo, userRepo } from '@vst/persistence';
import { type AppDeps } from '../app.ts';
import { hashToken, newToken } from '../identity/tokens.ts';
import { auth, requireAdmin, tripScope, type TripVars } from './middleware.ts';
import { jsonBig } from './json.ts';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

export function tripRoutes(deps: AppDeps) {
  const app = new Hono<{ Variables: TripVars }>();
  const { db, metrics, clock } = deps;

  app.use('/trips', auth(deps.sessions));
  app.use('/trips/*', auth(deps.sessions));
  app.use('/invites/*', auth(deps.sessions));
  app.use('/trips/:tripId', tripScope(db, metrics));
  app.use('/trips/:tripId/*', tripScope(db, metrics));

  // ---------------------------------------------------------------- trips
  app.get('/trips', async (c) => jsonBig(c, { trips: await tripRepo.listForUser(db, c.get('userId')) }));

  app.post('/trips', zValidator('json', createTrip), async (c) => {
    const body = c.req.valid('json');
    const userId = c.get('userId');
    const trip = await tripRepo.create(db, { ...body, createdBy: userId });
    // the creator is a participant from day one (claimed), named after their profile
    const u = await userRepo.get(db, userId);
    await participantRepo.add(db, { id: crypto.randomUUID(), tripId: trip.id, displayName: u?.displayName ?? u?.email?.split('@')[0] ?? 'Me', userId, joinedAt: clock.today(trip.timezone) });
    return jsonBig(c, await tripRepo.get(db, trip.id), 201);
  });

  app.get('/trips/:tripId', async (c) => {
    const tripId = c.get('tripId');
    const [trip, participants, members] = await Promise.all([
      tripRepo.get(db, tripId), participantRepo.list(db, tripId),
      db.select({ userId: schema.memberships.userId, role: schema.memberships.role }).from(schema.memberships).where(eq(schema.memberships.tripId, tripId)),
    ]);
    return jsonBig(c, { trip, participants, members, me: { userId: c.get('userId'), role: c.get('role') } });
  });

  app.patch('/trips/:tripId', zValidator('json', patchTrip), async (c) => {
    requireAdmin(c);
    return jsonBig(c, await tripRepo.update(db, c.get('tripId'), c.req.valid('json')));
  });

  /** FR-8.7: the domain decides; the database persists. */
  app.post('/trips/:tripId/transition', zValidator('json', transitionBody), async (c) => {
    const tripId = c.get('tripId');
    const trip = await tripRepo.get(db, tripId);
    const { shown } = await computeBalances(tripId, trip.baseCcy);
    const allZero = [...shown.values()].every((m) => m.minor === 0n);
    const r = transition(trip.status, c.req.valid('json').action, { isAdmin: c.get('role') === 'admin', allBalancesZero: allZero });
    if (!r.ok) throw new HTTPException(r.reason === 'NOT_ADMIN' ? 403 : 409, { message: r.reason });
    return jsonBig(c, await tripRepo.setStatus(db, tripId, r.status));
  });

  // ---------------------------------------------------------------- invites (FR-1.2)
  app.post('/trips/:tripId/invites', async (c) => {
    const token = newToken();
    const expiresAt = new Date(clock.nowMs() + INVITE_TTL_MS);
    await db.insert(schema.invites).values({ tokenHash: hashToken(token), tripId: c.get('tripId'), createdBy: c.get('userId'), expiresAt });
    metrics.invite('created');
    return jsonBig(c, { url: `${deps.appBaseUrl}/i/${token}`, expiresAt: expiresAt.toISOString() }, 201);
  });
  app.delete('/trips/:tripId/invites', async (c) => {
    requireAdmin(c);
    await db.update(schema.invites).set({ revokedAt: new Date(clock.nowMs()) }).where(and(eq(schema.invites.tripId, c.get('tripId')), isNull(schema.invites.revokedAt)));
    metrics.invite('revoked');
    return c.body(null, 204);
  });
  /** Redeemed only after authentication (FR-1.2 "never before"). */
  app.post('/invites/:token/accept', async (c) => {
    const inv = await db.query.invites.findFirst({ where: and(eq(schema.invites.tokenHash, hashToken(c.req.param('token'))), isNull(schema.invites.revokedAt), gt(schema.invites.expiresAt, new Date(clock.nowMs()))) });
    if (!inv) throw new HTTPException(404, { message: 'invite invalid or expired' });
    await db.insert(schema.memberships).values({ tripId: inv.tripId, userId: c.get('userId'), role: 'member' }).onConflictDoNothing();
    metrics.invite('accepted');
    const participants = await participantRepo.list(db, inv.tripId);
    const mine = participants.find((p) => p.userId === c.get('userId'));
    return jsonBig(c, { tripId: inv.tripId, participantId: mine?.id ?? null, unclaimed: participants.filter((p) => p.userId === null && p.tombstonedAt === null).map((p) => ({ id: p.id, displayName: p.displayName })) });
  });

  // ---------------------------------------------------------------- participants
  app.post('/trips/:tripId/participants', zValidator('json', addParticipant), async (c) => {
    const body = c.req.valid('json');
    const trip = await tripRepo.get(db, c.get('tripId'));
    return jsonBig(c, await participantRepo.add(db, { id: body.id, tripId: trip.id, displayName: body.displayName, joinedAt: body.joinedAt ?? clock.today(trip.timezone) }), 201);
  });
  app.post('/trips/:tripId/participants/:pid/claim', async (c) => jsonBig(c, await participantRepo.claim(db, c.get('tripId'), c.req.param('pid'), c.get('userId'))));
  app.delete('/trips/:tripId/participants/:pid', async (c) => {
    requireAdmin(c);
    await participantRepo.remove(db, c.get('tripId'), c.req.param('pid'));
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- ledger + feed (§6.3)
  app.get('/trips/:tripId/entries', zValidator('query', changesQuery), async (c) => {
    const { since, limit } = c.req.valid('query');
    const tripId = c.get('tripId');
    const cursor = BigInt(since);
    const [trip, entries, participants] = await Promise.all([
      tripRepo.get(db, tripId), entryRepo.changesSince(db, tripId, cursor, limit), participantRepo.changesSince(db, tripId, cursor),
    ]);
    const includeTrip = cursor === 0n || trip.metaSeq > cursor; // initial sync always carries the trip row
    const changed = entries.length > 0 || participants.length > 0 || trip.metaSeq > cursor;
    metrics.syncPoll(changed ? 'changes' : 'empty');
    return jsonBig(c, { seq: trip.seq, entries, participants, trip: includeTrip ? trip : null, more: entries.length === limit });
  });

  app.post('/trips/:tripId/entries', zValidator('json', wireEntry), async (c) => {
    const wire = c.req.valid('json');
    const tripId = c.get('tripId');
    await assertParticipants(tripId, wire);
    try {
      const rec = await entryRepo.create(db, tripId, wire, c.get('userId'));
      metrics.entryWrites(wire.type, 'create');
      return jsonBig(c, rec, 201);
    } catch (e) {
      // idempotent retry: the same client re-sending the same entry gets the stored row back
      if (e instanceof ConflictError && sameEntry(e.current as Record<string, unknown>, wire)) return jsonBig(c, e.current, 200);
      throw e;
    }
  });

  app.patch('/trips/:tripId/entries/:eid', zValidator('json', wireEntry), async (c) => {
    const wire = c.req.valid('json');
    if (wire.id !== c.req.param('eid')) throw new HTTPException(400, { message: 'id mismatch' });
    const tripId = c.get('tripId');
    await assertParticipants(tripId, wire);
    const rec = await entryRepo.update(db, tripId, wire, ifMatch(c.req.header('if-match')), c.get('userId'));
    metrics.entryWrites(wire.type, 'update');
    return jsonBig(c, rec);
  });

  app.delete('/trips/:tripId/entries/:eid', async (c) => {
    const rec = await entryRepo.setDeleted(db, c.get('tripId'), c.req.param('eid'), ifMatch(c.req.header('if-match')), true, c.get('userId'));
    metrics.entryWrites(rec.type, 'delete');
    return jsonBig(c, rec);
  });
  app.post('/trips/:tripId/entries/:eid/restore', async (c) => {
    const rec = await entryRepo.setDeleted(db, c.get('tripId'), c.req.param('eid'), ifMatch(c.req.header('if-match')), false, c.get('userId'));
    return jsonBig(c, rec);
  });
  /** FR-10.2: every recorded state of one entry, with who changed it and when. */
  app.get('/trips/:tripId/entries/:eid/history', async (c) =>
    jsonBig(c, await entryRepo.history(db, c.get('tripId'), c.req.param('eid'))));

  app.post('/trips/:tripId/entries/:eid/settle-share', zValidator('json', settleShare), async (c) => {
    const b = c.req.valid('json');
    await entryRepo.settleShare(db, c.get('tripId'), c.req.param('eid'), b.participantId, b.transferEntryId);
    return c.body(null, 204);
  });

  // ---------------------------------------------------------------- balances + settlement (server-side cross-check, FR-9.4)
  app.get('/trips/:tripId/balances', async (c) => {
    const tripId = c.get('tripId');
    const trip = await tripRepo.get(db, tripId);
    const { exact, shown, cost } = await computeBalances(tripId, trip.baseCcy);
    const report = await checkInvariants(db, { tripId });
    return jsonBig(c, {
      balances: Object.fromEntries([...exact].map(([id, v]) => [id, preciseToString(v)])),
      shown: Object.fromEntries([...shown].map(([id, v]) => [id, moneyToString(v)])),
      cost: moneyToString(cost),
      invariants: { ok: report.balanceSum.length === 0 && report.entrySum.length === 0 && report.closedTripWrite.length === 0 },
    });
  });

  app.get('/trips/:tripId/settlement', zValidator('query', settlementQuery), async (c) => {
    const q = c.req.valid('query');
    const tripId = c.get('tripId');
    const trip = await tripRepo.get(db, tripId);
    const ccy = currency(trip.baseCcy);
    const entries = (await entryRepo.list(db, tripId)).map(entryFromWire);
    const bal: Balances = balances(entries, ccy);
    const opts: PlanOptions = q.plan === 'bilateral' ? { kind: 'bilateral', matrix: grossMatrix(entries, ccy) } : q.plan === 'hub' ? { kind: 'hub', hub: (q.hub ?? '') as ParticipantId } : { kind: 'optimal' };
    const t0 = performance.now();
    const plan = settle(bal, ccy, opts, tripId);
    metrics.settlementPlan(plan.kind, plan.kind === 'optimal' ? (plan.minimal ? 'exact' : 'greedy') : 'n/a', (performance.now() - t0) / 1000);
    return jsonBig(c, {
      kind: plan.kind, minimal: plan.minimal,
      transfers: plan.transfers.map((t) => ({ from: t.from, to: t.to, amount: moneyToString(t.amount) })),
      rounding: Object.fromEntries([...plan.rounding].map(([id, v]) => [id, preciseToString(v)])),
    });
  });

  // ---------------------------------------------------------------- helpers
  async function computeBalances(tripId: string, ccyCode: string) {
    const ccy = currency(ccyCode);
    const entries = (await entryRepo.list(db, tripId)).map(entryFromWire);
    const participants = await participantRepo.list(db, tripId);
    const exact = balances(entries, ccy);
    const ids = participants.map((p) => p.id as ParticipantId);
    const values = ids.map((id) => exact.get(id) ?? { kind: 'precise' as const, scaled: 0n, ccy });
    const rounded = roundAll(values, zeroMoney(ccy), 'balances');
    const shown = new Map(ids.map((id, i) => [id, rounded[i] ?? zeroMoney(ccy)]));
    return { exact, shown, cost: tripCost(entries, ccy) };
  }

  /** Every referenced participant must belong to this trip (a foreign key alone would allow another trip's). */
  async function assertParticipants(tripId: string, wire: { payments: readonly { participantId: string }[]; shares: readonly { participantId: string }[] }): Promise<void> {
    const ids = new Set([...wire.payments, ...wire.shares].map((x) => x.participantId));
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.participants)
      .where(and(eq(schema.participants.tripId, tripId), sql`${schema.participants.id} IN ${[...ids]}`));
    if ((row?.n ?? 0) !== ids.size) throw new HTTPException(422, { message: 'unknown participant' });
  }

  return app;
}

function ifMatch(h: string | undefined): number {
  const v = Number.parseInt((h ?? '').replace(/"/g, ''), 10);
  if (!Number.isInteger(v) || v < 1) throw new HTTPException(428, { message: 'If-Match: <version> required' });
  return v;
}

function sameEntry(current: Record<string, unknown>, wire: Record<string, unknown>): boolean {
  const pick = (o: Record<string, unknown>) => JSON.stringify({ ...o, tripId: undefined, version: undefined, seq: undefined, updatedAt: undefined });
  return pick(current) === pick(wire);
}
