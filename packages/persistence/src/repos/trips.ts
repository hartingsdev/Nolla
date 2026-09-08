import { and, eq, sql } from 'drizzle-orm';
import { type TripStatus, allows, currency } from '@vst/domain';
import { type Db } from '../db';
import { ForbiddenWriteError, NotFoundError } from '../errors';
import { memberships, trips } from '../schema';

export interface TripRow {
  readonly id: string; readonly name: string; readonly baseCcy: string; readonly timezone: string;
  readonly status: TripStatus; readonly retentionDays: number; readonly createdBy: string;
  readonly seq: bigint; readonly metaSeq: bigint; readonly startDate: string | null; readonly endDate: string | null;
}

export interface CreateTrip {
  readonly id: string; readonly name: string; readonly baseCcy: string; readonly timezone?: string;
  readonly createdBy: string; readonly startDate?: string; readonly endDate?: string;
}

const toRow = (t: typeof trips.$inferSelect): TripRow => ({
  id: t.id, name: t.name, baseCcy: t.baseCcy, timezone: t.timezone, status: t.status, retentionDays: t.retentionDays,
  createdBy: t.createdBy, seq: t.seq, metaSeq: t.metaSeq, startDate: t.startDate, endDate: t.endDate,
});

/** Bump the per-trip change counter inside the caller's transaction and return the new value. */
export async function nextSeq(tx: Db, tripId: string): Promise<bigint> {
  const [row] = await tx.update(trips).set({ seq: sql`${trips.seq} + 1`, updatedAt: sql`now()` }).where(eq(trips.id, tripId)).returning({ seq: trips.seq });
  if (!row) throw new NotFoundError(`trip ${tripId}`);
  return row.seq;
}

export const tripRepo = {
  async create(db: Db, input: CreateTrip): Promise<TripRow> {
    const ccy = currency(input.baseCcy);
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(trips).values({
        id: input.id, name: input.name, baseCcy: ccy.code, ccyExponent: ccy.exponent, timezone: input.timezone ?? 'Europe/Berlin',
        createdBy: input.createdBy, startDate: input.startDate ?? null, endDate: input.endDate ?? null,
      }).returning();
      await tx.insert(memberships).values({ tripId: input.id, userId: input.createdBy, role: 'admin' });
      return toRow(row as typeof trips.$inferSelect);
    });
  },

  async get(db: Db, tripId: string): Promise<TripRow> {
    const row = await db.query.trips.findFirst({ where: eq(trips.id, tripId) });
    if (!row) throw new NotFoundError(`trip ${tripId}`);
    return toRow(row);
  },

  async listForUser(db: Db, userId: string): Promise<TripRow[]> {
    const rows = await db.select({ t: trips }).from(trips).innerJoin(memberships, and(eq(memberships.tripId, trips.id), eq(memberships.userId, userId)));
    return rows.map((r) => toRow(r.t));
  },

  async role(db: Db, tripId: string, userId: string): Promise<'member' | 'admin' | null> {
    const m = await db.query.memberships.findFirst({ where: and(eq(memberships.tripId, tripId), eq(memberships.userId, userId)) });
    return m?.role ?? null;
  },

  async update(db: Db, tripId: string, patch: Partial<Pick<TripRow, 'name' | 'startDate' | 'endDate' | 'retentionDays' | 'timezone'>>): Promise<TripRow> {
    return db.transaction(async (tx) => {
      const seq = await nextSeq(tx, tripId);
      const [row] = await tx.update(trips).set({ ...patch, metaSeq: seq }).where(eq(trips.id, tripId)).returning();
      return toRow(row as typeof trips.$inferSelect);
    });
  },

  /** The use-case decides via domain `transition`; this only persists the result and stamps the change. */
  async setStatus(db: Db, tripId: string, status: TripStatus): Promise<TripRow> {
    return db.transaction(async (tx) => {
      const seq = await nextSeq(tx, tripId);
      const [row] = await tx.update(trips).set({ status, metaSeq: seq }).where(eq(trips.id, tripId)).returning();
      return toRow(row as typeof trips.$inferSelect);
    });
  },

  /** Enforce FR-8.7 for a write kind; the closed case is also a database trigger. */
  async assertWritable(tx: Db, tripId: string, write: 'expense' | 'transfer' | 'adjustment' | 'membership'): Promise<void> {
    const t = await tx.query.trips.findFirst({ where: eq(trips.id, tripId), columns: { status: true } });
    if (!t) throw new NotFoundError(`trip ${tripId}`);
    if (!allows(t.status, write)) throw new ForbiddenWriteError(`trip ${tripId} is ${t.status}: ${write} writes are not allowed`);
  },
};
