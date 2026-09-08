import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { eq, sql } from 'drizzle-orm';
import {
  type ParticipantId, type WireEntry, allocate, balances, currency, entryDiff, entryFromWire, entryToWire, localDate, money, P, toPrecise,
} from '@vst/domain';
import { arbLedger } from '@vst/domain/testing';
import { type Connection } from './db';
import { ConflictError, ForbiddenWriteError } from './errors';
import { checkInvariants } from './invariants';
import { entryRepo, participantRepo, tripRepo, userRepo } from './index';
import { entries, participants, payments, shares } from './schema';
import { testConnection } from './testing/harness';

const EUR = currency('EUR');
let conn: Connection;
beforeAll(async () => { conn = await testConnection(); });
afterAll(async () => { await conn.close(); });

/**
 * Drizzle wraps driver errors as "Failed query: …" and puts the Postgres error on `cause`.
 * A DEFERRED constraint trigger fires at COMMIT, so on real Postgres the message only ever
 * appears down the cause chain; PGlite surfaces it directly. Walk the whole chain.
 */
async function expectDbError(p: Promise<unknown>, re: RegExp): Promise<void> {
  await expect(p).rejects.toSatisfy((e: unknown) => {
    for (let cur: unknown = e, depth = 0; cur && depth < 10; depth++) {
      const err = cur as { message?: unknown; cause?: unknown };
      if (typeof err.message === 'string' && re.test(err.message)) return true;
      cur = err.cause;
    }
    return false;
  });
}

interface Fixture { userId: string; tripId: string; pids: string[] }
async function fixture(n = 5): Promise<Fixture> {
  const db = conn.db;
  const userId = randomUUID();
  await userRepo.create(db, { id: userId, email: `${userId}@test`, displayName: 'Robert' });
  const tripId = randomUUID();
  await tripRepo.create(db, { id: tripId, name: 'Elsass', baseCcy: 'EUR', createdBy: userId });
  const pids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = randomUUID();
    await participantRepo.add(db, { id, tripId, displayName: `p${String(i)}`, joinedAt: '2026-03-01', userId: i === 0 ? userId : null });
    pids.push(id);
  }
  return { userId, tripId, pids };
}

function expense(id: string, amount: bigint, payer: string, among: string[], extra: Partial<WireEntry> = {}): WireEntry {
  const m = money(amount, EUR);
  return {
    ...entryToWire({
      id, type: 'expense', description: 'x', amount: m, date: localDate('2026-03-02'),
      payments: [{ participantId: payer as ParticipantId, amount: m }],
      shares: allocate(m, { kind: 'equal', among: among as ParticipantId[] }, { seed: id }),
      createdAt: '2026-03-02T10:00:00.000Z',
    }),
    ...extra,
  };
}

describe('entries', () => {
  let f: Fixture;
  beforeEach(async () => { f = await fixture(); });

  it('keeps an audit trail: who created it, and who changed what afterwards (FR-10.2)', async () => {
    const w = expense(randomUUID(), 5518n, f.pids[0]!, f.pids);
    await entryRepo.create(conn.db, f.tripId, w, f.userId);

    // A fresh entry has no revisions yet — only the creation the entry itself records.
    const first = await entryRepo.history(conn.db, f.tripId, w.id);
    expect(first.revisions).toHaveLength(0);
    expect(first.createdBy).toEqual({ userId: f.userId, displayName: 'Robert' });
    expect(first.current.version).toBe(1);

    // Someone else renames it, then deletes it.
    const otherId = randomUUID();
    await userRepo.create(conn.db, { id: otherId, email: `${otherId}@test`, displayName: 'Max' });
    await entryRepo.update(conn.db, f.tripId, { ...w, description: 'renamed' }, 1, otherId);
    await entryRepo.setDeleted(conn.db, f.tripId, w.id, 2, true, f.userId);

    const h = await entryRepo.history(conn.db, f.tripId, w.id);
    expect(h.revisions.map((r) => r.version)).toEqual([1, 2]);
    expect(h.revisions[0]?.actor).toEqual({ userId: otherId, displayName: 'Max' });
    expect(h.revisions[1]?.actor).toEqual({ userId: f.userId, displayName: 'Robert' });
    // Each row holds the state BEFORE its change, so the chain reconstructs every step.
    expect(h.revisions[0]?.snapshot.description).toBe('x');
    expect(h.revisions[1]?.snapshot.description).toBe('renamed');
    expect(h.revisions[1]?.snapshot.deleted).toBeFalsy();
    expect(h.current.deleted).toBe(true);
    expect(entryDiff(h.revisions[0]!.snapshot, h.revisions[1]!.snapshot).fields)
      .toEqual([{ field: 'description', from: 'x', to: 'renamed' }]);
  });

  it('an entry id from another trip has no history here', async () => {
    const other = await fixture(2);
    const w = expense(randomUUID(), 1000n, f.pids[0]!, f.pids);
    await entryRepo.create(conn.db, f.tripId, w, f.userId);
    await expect(entryRepo.history(conn.db, other.tripId, w.id)).rejects.toThrow(/not found/);
  });

  it('round-trips an expense through the database exactly', async () => {
    const w = expense(randomUUID(), 5518n, f.pids[0]!, f.pids, { category: 'groceries' });
    const rec = await entryRepo.create(conn.db, f.tripId, w, f.userId);
    expect(rec.version).toBe(1);
    expect(rec.seq).toBeGreaterThan(0n);
    const { tripId: _t, version: _v, seq: _s, updatedAt: _u, ...wire } = rec;
    expect(wire).toEqual(w);
    expect(wire.shares.map((s) => s.amount)).toEqual(Array<string>(5).fill('11.03600000'));
  });

  it('rejects an entry whose shares do not sum to the amount — at the database, even bypassing the repo', async () => {
    const id = randomUUID();
    await expectDbError(conn.db.transaction(async (tx) => {
      await tx.insert(entries).values({ id, tripId: f.tripId, type: 'expense', description: 'bad', amountMinor: 1000n, ccy: 'EUR', ccyExponent: 2, date: '2026-03-02', seq: 1n });
      await tx.insert(payments).values({ entryId: id, tripId: f.tripId, participantId: f.pids[0]!, amountMinor: 1000n });
      await tx.insert(shares).values([
        { entryId: id, tripId: f.tripId, participantId: f.pids[0]!, amount: '5.00000000' },
        { entryId: id, tripId: f.tripId, participantId: f.pids[1]!, amount: '4.99000000' },
      ]);
    }), /I1: entry .* shares sum/);
    expect(await entryRepo.list(conn.db, f.tripId)).toHaveLength(0);
  });

  it('rejects payments that do not sum to the amount, and an entry without shares', async () => {
    const id = randomUUID();
    await expectDbError(conn.db.transaction(async (tx) => {
      await tx.insert(entries).values({ id, tripId: f.tripId, type: 'expense', description: 'bad', amountMinor: 1000n, ccy: 'EUR', ccyExponent: 2, date: '2026-03-02', seq: 1n });
      await tx.insert(payments).values({ entryId: id, tripId: f.tripId, participantId: f.pids[0]!, amountMinor: 999n });
      await tx.insert(shares).values({ entryId: id, tripId: f.tripId, participantId: f.pids[0]!, amount: '10.00000000' });
    }), /I1: entry .* payments sum/);
    await expectDbError(conn.db.transaction(async (tx) => {
      await tx.insert(entries).values({ id: randomUUID(), tripId: f.tripId, type: 'expense', description: 'bad', amountMinor: 0n, ccy: 'EUR', ccyExponent: 2, date: '2026-03-02', seq: 1n });
    }), /at least one payment and one share/);
  });

  it('optimistic update: stale version conflicts and returns the current row', async () => {
    const w = expense(randomUUID(), 5518n, f.pids[0]!, f.pids);
    await entryRepo.create(conn.db, f.tripId, w, f.userId);
    const v2 = await entryRepo.update(conn.db, f.tripId, { ...w, description: 'renamed' }, 1, f.userId);
    expect(v2.version).toBe(2);
    await expect(entryRepo.update(conn.db, f.tripId, { ...w, description: 'stale' }, 1, f.userId)).rejects.toBeInstanceOf(ConflictError);
    try { await entryRepo.update(conn.db, f.tripId, { ...w, description: 'stale' }, 1, f.userId); }
    catch (e) { expect((e as ConflictError<{ description: string }>).current.description).toBe('renamed'); }
  });

  it('create is idempotent on id for an identical entry attempt (conflict carries the stored row)', async () => {
    const w = expense(randomUUID(), 100n, f.pids[0]!, f.pids);
    await entryRepo.create(conn.db, f.tripId, w, f.userId);
    await expect(entryRepo.create(conn.db, f.tripId, w, f.userId)).rejects.toBeInstanceOf(ConflictError);
  });

  it('change feed returns entries after a cursor in order, deletions as tombstones', async () => {
    const a = expense(randomUUID(), 100n, f.pids[0]!, f.pids);
    const b = expense(randomUUID(), 200n, f.pids[1]!, f.pids);
    const ra = await entryRepo.create(conn.db, f.tripId, a, f.userId);
    const rb = await entryRepo.create(conn.db, f.tripId, b, f.userId);
    expect(rb.seq).toBeGreaterThan(ra.seq);
    const since = ra.seq;
    let feed = await entryRepo.changesSince(conn.db, f.tripId, since);
    expect(feed.map((e) => e.id)).toEqual([b.id]);
    const del = await entryRepo.setDeleted(conn.db, f.tripId, a.id, 1, true, f.userId);
    feed = await entryRepo.changesSince(conn.db, f.tripId, rb.seq);
    expect(feed.map((e) => [e.id, e.deleted])).toEqual([[a.id, true]]);
    expect(del.deleted).toBe(true);
    expect(await entryRepo.list(conn.db, f.tripId)).toHaveLength(1);
    expect(await entryRepo.list(conn.db, f.tripId, { includeDeleted: true })).toHaveLength(2);
  });

  it('cross-trip access is a not-found, never a leak', async () => {
    const other = await fixture(2);
    const w = expense(randomUUID(), 100n, f.pids[0]!, f.pids);
    await entryRepo.create(conn.db, f.tripId, w, f.userId);
    await expect(entryRepo.get(conn.db, other.tripId, w.id)).rejects.toThrow(/not found/);
  });

  it('settleShare links a share to its transfer (FR-7.4)', async () => {
    const w = expense(randomUUID(), 1000n, f.pids[0]!, [f.pids[0]!, f.pids[1]!]);
    await entryRepo.create(conn.db, f.tripId, w, f.userId);
    const t = money(500n, EUR);
    const transfer = entryToWire({
      id: randomUUID(), type: 'transfer', description: 'pay', amount: t, date: localDate('2026-03-03'),
      payments: [{ participantId: f.pids[1] as ParticipantId, amount: t }], shares: [{ participantId: f.pids[0] as ParticipantId, amount: toPrecise(t) }], createdAt: '2026-03-03T00:00:00.000Z',
    });
    await entryRepo.create(conn.db, f.tripId, transfer, f.userId);
    await entryRepo.settleShare(conn.db, f.tripId, w.id, f.pids[1]!, transfer.id);
    const rec = await entryRepo.get(conn.db, f.tripId, w.id);
    expect(rec.shares.find((s) => s.participantId === f.pids[1])?.settledBy).toBe(transfer.id);
    // deleting the transfer row entirely clears the link (ON DELETE SET NULL)
    await conn.db.delete(entries).where(eq(entries.id, transfer.id));
    const after = await entryRepo.get(conn.db, f.tripId, w.id);
    expect(after.shares.find((s) => s.participantId === f.pids[1])?.settledBy).toBeUndefined();
  });
});

describe('trip lifecycle at the database (I5, FR-8.7)', () => {
  it('a closed trip rejects ledger writes from the repo and from raw SQL', async () => {
    const f = await fixture();
    const w = expense(randomUUID(), 100n, f.pids[0]!, f.pids);
    await entryRepo.create(conn.db, f.tripId, w, f.userId);
    await tripRepo.setStatus(conn.db, f.tripId, 'settling');
    await expect(entryRepo.create(conn.db, f.tripId, expense(randomUUID(), 100n, f.pids[0]!, f.pids), f.userId)).rejects.toBeInstanceOf(ForbiddenWriteError);
    await tripRepo.setStatus(conn.db, f.tripId, 'closed');
    await expectDbError(conn.db.update(entries).set({ description: 'sneaky' }).where(eq(entries.id, w.id)), /I5: trip .* is closed/);
    await expectDbError(conn.db.delete(payments).where(eq(payments.entryId, w.id)), /I5/);
    await tripRepo.setStatus(conn.db, f.tripId, 'open');
    await expect(entryRepo.update(conn.db, f.tripId, { ...w, description: 'ok' }, 1, f.userId)).resolves.toMatchObject({ description: 'ok' });
  });
});

describe('participants', () => {
  it('cannot be removed while referenced; placeholders can be claimed', async () => {
    const f = await fixture(3);
    await entryRepo.create(conn.db, f.tripId, expense(randomUUID(), 300n, f.pids[0]!, f.pids), f.userId);
    await expect(participantRepo.remove(conn.db, f.tripId, f.pids[2]!)).rejects.toBeInstanceOf(ForbiddenWriteError);
    const u2 = randomUUID();
    await userRepo.create(conn.db, { id: u2 });
    const claimed = await participantRepo.claim(conn.db, f.tripId, f.pids[2]!, u2);
    expect(claimed.userId).toBe(u2);
    await expect(participantRepo.claim(conn.db, f.tripId, f.pids[2]!, u2)).rejects.toBeInstanceOf(ForbiddenWriteError);
    const free = await participantRepo.add(conn.db, { id: randomUUID(), tripId: f.tripId, displayName: 'Lena', joinedAt: '2026-03-03' });
    await participantRepo.remove(conn.db, f.tripId, free.id);
    expect((await participantRepo.list(conn.db, f.tripId)).map((p) => p.id)).not.toContain(free.id);
  });
});

describe('account deletion (FR-1.9)', () => {
  it('detaches the user and tombstones the participant; every other balance is unchanged', async () => {
    const f = await fixture(3);
    await entryRepo.create(conn.db, f.tripId, expense(randomUUID(), 9000n, f.pids[0]!, f.pids), f.userId);
    const before = balances((await entryRepo.list(conn.db, f.tripId)).map(entryFromWire), EUR);
    await userRepo.deleteAccount(conn.db, f.userId);
    const u = await userRepo.get(conn.db, f.userId);
    expect(u?.email).toBeNull(); expect(u?.deletedAt).not.toBeNull();
    const p = (await participantRepo.list(conn.db, f.tripId)).find((x) => x.id === f.pids[0]);
    expect(p?.userId).toBeNull(); expect(p?.tombstonedAt).not.toBeNull(); expect(p?.displayName).toBe('p0');
    expect(await tripRepo.role(conn.db, f.tripId, f.userId)).toBeNull();
    const after = balances((await entryRepo.list(conn.db, f.tripId)).map(entryFromWire), EUR);
    for (const [id, v] of before) expect(P.eq(after.get(id)!, v)).toBe(true);
    expect((await checkInvariants(conn.db)).balanceSum).toEqual([]);
  });
});

describe('invariant check', () => {
  it('is clean on a healthy database and flags a corrupted payment', async () => {
    const f = await fixture(2);
    const w = expense(randomUUID(), 1000n, f.pids[0]!, f.pids);
    await entryRepo.create(conn.db, f.tripId, w, f.userId);
    let report = await checkInvariants(conn.db);
    expect(report.entrySum).toEqual([]); expect(report.balanceSum).toEqual([]); expect(report.tripsChecked).toBeGreaterThan(0);
    // corrupt behind the trigger's back
    await conn.exec(`ALTER TABLE payments DISABLE TRIGGER ALL; UPDATE payments SET amount_minor = 999 WHERE entry_id = '${w.id}'; ALTER TABLE payments ENABLE TRIGGER ALL;`);
    report = await checkInvariants(conn.db);
    expect(report.entrySum).toEqual([w.id]);
    expect(report.balanceSum).toEqual([f.tripId]);
    // scoped to another trip, the corruption is invisible
    const other = await fixture(1);
    expect((await checkInvariants(conn.db, { tripId: other.tripId })).entrySum).toEqual([]);
    // repair, so later whole-database checks in this suite stay clean
    await conn.exec(`ALTER TABLE payments DISABLE TRIGGER ALL; UPDATE payments SET amount_minor = 1000 WHERE entry_id = '${w.id}'; ALTER TABLE payments ENABLE TRIGGER ALL;`);
    expect((await checkInvariants(conn.db)).entrySum).toEqual([]);
  });
});

describe('random ledgers through the real database', () => {
  it('what goes in comes out, and balances agree with the domain', async () => {
    await fc.assert(fc.asyncProperty(arbLedger(EUR, { maxParticipants: 6, maxEntries: 12 }), async ({ ids, entries: gen }) => {
      const f = await fixture(ids.length);
      const map = new Map(ids.map((id, i) => [id, f.pids[i]!]));
      const wires = gen.map((e) => entryToWire({
        ...e, description: 'g', createdAt: '2026-07-01T00:00:00.000Z',
        payments: e.payments.map((p) => ({ ...p, participantId: map.get(p.participantId) as ParticipantId })),
        shares: e.shares.map((s) => ({ ...s, participantId: map.get(s.participantId) as ParticipantId })),
      }));
      for (const w of wires) await entryRepo.create(conn.db, f.tripId, { ...w, id: randomUUID() }, f.userId);
      const stored = (await entryRepo.list(conn.db, f.tripId)).map(entryFromWire);
      const expected = balances(wires.map(entryFromWire), EUR);
      const actual = balances(stored, EUR);
      for (const [id, v] of expected) expect(P.eq(actual.get(id) ?? toPrecise(money(0n, EUR)), v)).toBe(true);
      const report = await checkInvariants(conn.db, { tripId: f.tripId });
      expect(report.entrySum).toEqual([]); expect(report.balanceSum).toEqual([]); expect(report.tripsChecked).toBe(1);
    }), { numRuns: 12 });
  });
});

describe('seq is monotonic per trip', () => {
  it('every write bumps the counter exactly once', async () => {
    const f = await fixture(2);
    const t0 = (await tripRepo.get(conn.db, f.tripId)).seq;
    await entryRepo.create(conn.db, f.tripId, expense(randomUUID(), 100n, f.pids[0]!, f.pids), f.userId);
    await participantRepo.add(conn.db, { id: randomUUID(), tripId: f.tripId, displayName: 'x', joinedAt: '2026-01-01' });
    await tripRepo.update(conn.db, f.tripId, { name: 'renamed' });
    const t1 = await tripRepo.get(conn.db, f.tripId);
    expect(t1.seq - t0).toBe(3n);
    expect(t1.metaSeq).toBe(t1.seq);
    const [row] = await conn.db.select({ n: sql<number>`count(*)::int` }).from(participants).where(eq(participants.tripId, f.tripId));
    expect(row?.n).toBe(3);
  });
});
