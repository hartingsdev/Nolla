import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { type WireEntry, type WireSplit, currency, entryFromWire, validateEntry } from '@vst/domain';
import { type Db } from '../db';
import { ConflictError, NotFoundError } from '../errors';
import { entries, entryHistory, payments, shares, users } from '../schema';
import { nextSeq, tripRepo } from './trips';

/** WireEntry plus what persistence adds. Money stays a string here (P6). */
export interface EntryRecord extends WireEntry {
  readonly tripId: string;
  readonly version: number;
  readonly seq: bigint;
  readonly updatedAt: string;
}

export interface Actor { readonly userId: string; readonly displayName: string | null }

/** One recorded state of an entry, plus who replaced it and when (FR-10.2). */
export interface EntryRevision {
  readonly version: number;
  readonly at: string;
  readonly actor: Actor | null;
  readonly snapshot: WireEntry;
}

export interface EntryHistory {
  readonly entryId: string;
  readonly createdAt: string;
  readonly createdBy: Actor | null;
  readonly revisions: readonly EntryRevision[];
  readonly current: EntryRecord;
}

type EntryRow = typeof entries.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type ShareRow = typeof shares.$inferSelect;

function minorToString(minor: bigint, exponent: number): string {
  const neg = minor < 0n; const abs = (neg ? -minor : minor).toString().padStart(exponent + 1, '0');
  const i = abs.length - exponent;
  return `${neg ? '-' : ''}${abs.slice(0, i)}${exponent ? '.' + abs.slice(i) : ''}`;
}
function stringToMinor(s: string, exponent: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`bad money string ${s}`);
  const frac = (m[3] ?? '').padEnd(exponent, '0').slice(0, exponent);
  const v = BigInt((m[2] ?? '0') + frac);
  return m[1] === '-' ? -v : v;
}
/** numeric(20,8) comes back like "11.036" or "11.03600000"; normalise to exactly 8 fraction digits. */
function normalisePrecise(s: string): string {
  const [i, f = ''] = s.split('.');
  return `${i ?? '0'}.${f.padEnd(8, '0').slice(0, 8)}`;
}

/** entry_history snapshots are JSON; bigint fields (seq) become strings. */
function snapshot(rec: EntryRecord): Record<string, unknown> {
  return JSON.parse(JSON.stringify(rec, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as Record<string, unknown>;
}

export function toRecord(e: EntryRow, ps: readonly PaymentRow[], ss: readonly ShareRow[]): EntryRecord {
  return {
    id: e.id, tripId: e.tripId, type: e.type, description: e.description,
    amount: minorToString(e.amountMinor, e.ccyExponent), ccy: e.ccy, date: e.date,
    payments: ps.map((p) => ({ participantId: p.participantId, amount: minorToString(p.amountMinor, e.ccyExponent) })),
    shares: ss.map((s) => ({ participantId: s.participantId, amount: normalisePrecise(s.amount), ...(s.settledByEntry ? { settledBy: s.settledByEntry } : {}) })),
    ...(e.reason !== null ? { reason: e.reason } : {}),
    ...(e.category !== null ? { category: e.category } : {}),
    ...(e.splitRule !== null ? { split: e.splitRule as WireSplit } : {}),
    createdAt: e.createdAt.toISOString(),
    ...(e.deletedAt ? { deleted: true } : {}),
    version: e.version, seq: e.seq, updatedAt: e.updatedAt.toISOString(),
  };
}

async function loadChildren(db: Db, entryIds: readonly string[]): Promise<{ ps: Map<string, PaymentRow[]>; ss: Map<string, ShareRow[]> }> {
  const ps = new Map<string, PaymentRow[]>(); const ss = new Map<string, ShareRow[]>();
  if (entryIds.length === 0) return { ps, ss };
  for (const p of await db.select().from(payments).where(inArray(payments.entryId, [...entryIds])).orderBy(asc(payments.ord), asc(payments.participantId))) {
    (ps.get(p.entryId) ?? ps.set(p.entryId, []).get(p.entryId))?.push(p);
  }
  for (const s of await db.select().from(shares).where(inArray(shares.entryId, [...entryIds])).orderBy(asc(shares.ord), asc(shares.participantId))) {
    (ss.get(s.entryId) ?? ss.set(s.entryId, []).get(s.entryId))?.push(s);
  }
  return { ps, ss };
}

async function assemble(db: Db, rows: EntryRow[]): Promise<EntryRecord[]> {
  const { ps, ss } = await loadChildren(db, rows.map((r) => r.id));
  return rows.map((r) => toRecord(r, ps.get(r.id) ?? [], ss.get(r.id) ?? []));
}

export const entryRepo = {
  async get(db: Db, tripId: string, entryId: string): Promise<EntryRecord> {
    const row = await db.query.entries.findFirst({ where: and(eq(entries.id, entryId), eq(entries.tripId, tripId)) });
    if (!row) throw new NotFoundError(`entry ${entryId}`);
    return (await assemble(db, [row]))[0] as EntryRecord;
  },

  async list(db: Db, tripId: string, opts: { includeDeleted?: boolean } = {}): Promise<EntryRecord[]> {
    const rows = await db.query.entries.findMany({ where: eq(entries.tripId, tripId), orderBy: [asc(entries.date), asc(entries.createdAt)] });
    const out = await assemble(db, rows);
    return opts.includeDeleted ? out : out.filter((e) => !e.deleted);
  },

  /** Change feed (architecture.md §6.3): everything with seq > since, deletions included as tombstones. */
  async changesSince(db: Db, tripId: string, since: bigint, limit = 500): Promise<EntryRecord[]> {
    const rows = await db.query.entries.findMany({ where: and(eq(entries.tripId, tripId), gt(entries.seq, since)), orderBy: asc(entries.seq), limit });
    return assemble(db, rows);
  },

  /**
   * Create an entry. Validates with the domain first (fast, readable errors); the deferred
   * database trigger re-checks I1 at commit regardless. Idempotent on id: re-creating an
   * identical entry is a no-op, a different one is a conflict.
   */
  async create(db: Db, tripId: string, wire: WireEntry, actor: string | null): Promise<EntryRecord> {
    const domain = entryFromWire(wire);
    validateEntry(domain);
    const ccy = currency(wire.ccy);
    return db.transaction(async (tx) => {
      const existing = await tx.query.entries.findFirst({ where: eq(entries.id, wire.id) });
      if (existing) {
        if (existing.tripId !== tripId) throw new NotFoundError(`entry ${wire.id}`);
        const cur = (await assemble(tx, [existing]))[0] as EntryRecord;
        throw new ConflictError(cur);
      }
      await tripRepo.assertWritable(tx, tripId, wire.type);
      const seq = await nextSeq(tx, tripId);
      await tx.insert(entries).values({
        id: wire.id, tripId, type: wire.type, description: wire.description,
        amountMinor: stringToMinor(wire.amount, ccy.exponent), ccy: ccy.code, ccyExponent: ccy.exponent,
        date: wire.date, category: wire.category ?? null, reason: wire.reason ?? null, splitRule: wire.split ?? null, seq, createdBy: actor,
        createdAt: new Date(wire.createdAt), deletedAt: wire.deleted ? new Date() : null,
      });
      await writeChildren(tx, tripId, wire, ccy.exponent);
      return entryRepo.get(tx, tripId, wire.id);
    });
  },

  /** Optimistic update (FR-9.5): `expectedVersion` must match or a ConflictError carrying the current row is thrown. */
  async update(db: Db, tripId: string, wire: WireEntry, expectedVersion: number, actor: string | null): Promise<EntryRecord> {
    const domain = entryFromWire(wire);
    validateEntry(domain);
    const ccy = currency(wire.ccy);
    return db.transaction(async (tx) => {
      const current = await entryRepo.get(tx, tripId, wire.id);
      if (current.version !== expectedVersion) throw new ConflictError(current);
      await tripRepo.assertWritable(tx, tripId, wire.type);
      const seq = await nextSeq(tx, tripId);
      await tx.insert(entryHistory).values({ entryId: wire.id, tripId, version: current.version, actor, snapshot: snapshot(current) });
      await tx.update(entries).set({
        type: wire.type, description: wire.description, amountMinor: stringToMinor(wire.amount, ccy.exponent), ccy: ccy.code, ccyExponent: ccy.exponent,
        date: wire.date, category: wire.category ?? null, reason: wire.reason ?? null, splitRule: wire.split ?? null, version: current.version + 1, seq, updatedAt: new Date(),
        deletedAt: wire.deleted ? new Date() : null,
      }).where(and(eq(entries.id, wire.id), eq(entries.version, expectedVersion)));
      await tx.delete(payments).where(eq(payments.entryId, wire.id));
      await tx.delete(shares).where(eq(shares.entryId, wire.id));
      await writeChildren(tx, tripId, wire, ccy.exponent);
      return entryRepo.get(tx, tripId, wire.id);
    });
  },

  async setDeleted(db: Db, tripId: string, entryId: string, expectedVersion: number, deleted: boolean, actor: string | null): Promise<EntryRecord> {
    return db.transaction(async (tx) => {
      const current = await entryRepo.get(tx, tripId, entryId);
      if (current.version !== expectedVersion) throw new ConflictError(current);
      await tripRepo.assertWritable(tx, tripId, current.type);
      const seq = await nextSeq(tx, tripId);
      await tx.insert(entryHistory).values({ entryId, tripId, version: current.version, actor, snapshot: snapshot(current) });
      await tx.update(entries).set({ deletedAt: deleted ? new Date() : null, version: current.version + 1, seq, updatedAt: new Date() }).where(eq(entries.id, entryId));
      return entryRepo.get(tx, tripId, entryId);
    });
  },

  /**
   * The audit trail for one entry (FR-10.2).
   *
   * A history row holds the state the entry was in BEFORE a change, the version
   * it had then, and who made the change that replaced it. So the trail reads as
   * a chain: created → snapshot(v1) → snapshot(v2) → … → the row as it stands.
   * Creation itself has no history row; it comes off the entry's own createdBy.
   *
   * Actor display names are resolved here rather than in the client, because a
   * member who never claimed a participant — or whose account is gone — has no
   * name anywhere else.
   */
  async history(db: Db, tripId: string, entryId: string): Promise<EntryHistory> {
    const row = await db.query.entries.findFirst({ where: and(eq(entries.id, entryId), eq(entries.tripId, tripId)) });
    if (!row) throw new NotFoundError(`entry ${entryId}`);
    const revisions = await db.query.entryHistory.findMany({
      where: and(eq(entryHistory.entryId, entryId), eq(entryHistory.tripId, tripId)),
      orderBy: asc(entryHistory.version),
    });
    const actorIds = [...new Set([row.createdBy, ...revisions.map((r) => r.actor)].filter((x): x is string => x !== null))];
    const people = actorIds.length === 0 ? [] : await db.query.users.findMany({ where: inArray(users.id, actorIds) });
    const actor = (id: string | null): Actor | null => {
      if (id === null) return null;
      const u = people.find((x) => x.id === id);
      return { userId: id, displayName: u?.displayName ?? u?.email?.split('@')[0] ?? null };
    };
    return {
      entryId,
      createdAt: row.createdAt.toISOString(),
      createdBy: actor(row.createdBy),
      revisions: revisions.map((r) => ({
        version: r.version,
        at: r.at.toISOString(),
        actor: actor(r.actor),
        snapshot: r.snapshot as WireEntry,
      })),
      current: await entryRepo.get(db, tripId, entryId),
    };
  },

  /** FR-7.4: link a share to the transfer that settled it. */
  async settleShare(db: Db, tripId: string, entryId: string, participantId: string, transferEntryId: string | null): Promise<void> {
    await db.transaction(async (tx) => {
      await tripRepo.assertWritable(tx, tripId, 'transfer');
      const seq = await nextSeq(tx, tripId);
      await tx.update(shares).set({ settledByEntry: transferEntryId }).where(and(eq(shares.entryId, entryId), eq(shares.participantId, participantId), eq(shares.tripId, tripId)));
      await tx.update(entries).set({ seq, updatedAt: new Date() }).where(eq(entries.id, entryId));
    });
  },
};

async function writeChildren(tx: Db, tripId: string, wire: WireEntry, exponent: number): Promise<void> {
  await tx.insert(payments).values(wire.payments.map((p, ord) => ({ entryId: wire.id, tripId, participantId: p.participantId, amountMinor: stringToMinor(p.amount, exponent), ord })));
  await tx.insert(shares).values(wire.shares.map((s, ord) => ({ entryId: wire.id, tripId, participantId: s.participantId, amount: s.amount, settledByEntry: s.settledBy ?? null, ord })));
}
