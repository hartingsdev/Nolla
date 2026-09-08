import { sql } from 'drizzle-orm';
import { type Db, rawRows } from './db';

export interface InvariantReport {
  readonly tripsChecked: number;
  /** trip ids whose live balances do not sum to zero (I2) */
  readonly balanceSum: string[];
  /** entry ids whose payments or shares do not sum to the amount (I1) */
  readonly entrySum: string[];
  /** closed trips with entries written after closing (I5) */
  readonly closedTripWrite: string[];
}

/**
 * The nightly correctness check (NFR-12, observability.md §3.2). Pure SQL over the whole
 * database so it does not depend on the application code being right. Feeds the
 * vst_invariant_* gauges; exits non-zero when anything is off.
 */
export async function checkInvariants(db: Db, opts: { tripId?: string } = {}): Promise<InvariantReport> {
  // Optional trip scope: the per-trip reconciliation self-check (FR-9.4) reuses the nightly queries.
  const scopeT = opts.tripId ? sql`WHERE id = ${opts.tripId}` : sql``;
  const scopeE = opts.tripId ? sql`AND e.trip_id = ${opts.tripId}` : sql``;
  const trips = await rawRows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM trips ${scopeT}`);
  const balance = await rawRows<{ trip_id: string }>(db, sql`
    WITH flows AS (
      SELECT p.trip_id, p.amount_minor::numeric / power(10::numeric, e.ccy_exponent) AS v
        FROM payments p JOIN entries e ON e.id = p.entry_id WHERE e.deleted_at IS NULL ${scopeE}
      UNION ALL
      SELECT s.trip_id, -s.amount FROM shares s JOIN entries e ON e.id = s.entry_id WHERE e.deleted_at IS NULL ${scopeE}
    )
    SELECT trip_id FROM flows GROUP BY trip_id HAVING sum(v) <> 0`);
  const entrySum = await rawRows<{ id: string }>(db, sql`
    SELECT e.id FROM entries e
    WHERE (
         (SELECT coalesce(sum(amount_minor), 0) FROM payments WHERE entry_id = e.id) <> e.amount_minor
      OR (SELECT coalesce(sum(amount), 0) FROM shares WHERE entry_id = e.id) <> e.amount_minor::numeric / power(10::numeric, e.ccy_exponent)
      OR NOT EXISTS (SELECT 1 FROM payments WHERE entry_id = e.id)
      OR NOT EXISTS (SELECT 1 FROM shares WHERE entry_id = e.id)
    ) ${scopeE}`);
  const closed = await rawRows<{ id: string }>(db, sql`
    SELECT DISTINCT t.id FROM trips t JOIN entries e ON e.trip_id = t.id
    WHERE t.status = 'closed' AND e.updated_at > t.updated_at ${scopeE}`);
  return {
    tripsChecked: trips[0]?.n ?? 0,
    balanceSum: balance.map((r) => r.trip_id),
    entrySum: entrySum.map((r) => r.id),
    closedTripWrite: closed.map((r) => r.id),
  };
}
