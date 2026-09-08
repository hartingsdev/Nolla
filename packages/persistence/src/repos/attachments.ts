import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { type Db, rawRows } from '../db';
import { NotFoundError } from '../errors';
import { attachments, entries } from '../schema';
import { nextSeq, tripRepo } from './trips';

export interface AttachmentRow { readonly id: string; readonly entryId: string; readonly tripId: string; readonly blobKey: string; readonly bytes: bigint; readonly mime: string; readonly uploadedAt: Date; readonly deletedAt: Date | null }

const toRow = (a: typeof attachments.$inferSelect): AttachmentRow => ({ id: a.id, entryId: a.entryId, tripId: a.tripId, blobKey: a.blobKey, bytes: a.bytes, mime: a.mime, uploadedAt: a.uploadedAt, deletedAt: a.deletedAt });

export const attachmentRepo = {
  async create(db: Db, input: { id: string; tripId: string; entryId: string; blobKey: string; bytes: bigint; mime: string }): Promise<AttachmentRow> {
    return db.transaction(async (tx) => {
      const e = await tx.query.entries.findFirst({ where: and(eq(entries.id, input.entryId), eq(entries.tripId, input.tripId)) });
      if (!e) throw new NotFoundError(`entry ${input.entryId}`);
      await tripRepo.assertWritable(tx, input.tripId, e.type);
      const seq = await nextSeq(tx, input.tripId);
      await tx.update(entries).set({ seq, updatedAt: new Date() }).where(eq(entries.id, input.entryId)); // feed consumers learn the entry changed
      const [row] = await tx.insert(attachments).values({ ...input }).returning();
      if (!row) throw new NotFoundError('attachment');
      return toRow(row);
    });
  },
  /** The client reports the byte count it uploaded; until then the row counts as unconfirmed. */
  async confirm(db: Db, tripId: string, id: string, bytes: bigint): Promise<AttachmentRow> {
    const [row] = await db.update(attachments).set({ bytes }).where(and(eq(attachments.id, id), eq(attachments.tripId, tripId), isNull(attachments.deletedAt))).returning();
    if (!row) throw new NotFoundError(`attachment ${id}`);
    return toRow(row);
  },
  async listByEntry(db: Db, tripId: string, entryId: string): Promise<AttachmentRow[]> {
    const rows = await db.query.attachments.findMany({ where: and(eq(attachments.tripId, tripId), eq(attachments.entryId, entryId), isNull(attachments.deletedAt)), orderBy: desc(attachments.uploadedAt) });
    return rows.map(toRow);
  },
  async get(db: Db, tripId: string, id: string): Promise<AttachmentRow> {
    const row = await db.query.attachments.findFirst({ where: and(eq(attachments.id, id), eq(attachments.tripId, tripId), isNull(attachments.deletedAt)) });
    if (!row) throw new NotFoundError(`attachment ${id}`);
    return toRow(row);
  },
  async softDelete(db: Db, tripId: string, id: string): Promise<AttachmentRow> {
    return db.transaction(async (tx) => {
      const a = await attachmentRepo.get(tx, tripId, id);
      await tripRepo.assertWritable(tx, tripId, 'transfer'); // receipts may still be removed while settling
      const seq = await nextSeq(tx, tripId);
      await tx.update(entries).set({ seq, updatedAt: new Date() }).where(eq(entries.id, a.entryId));
      const [row] = await tx.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, id)).returning();
      if (!row) throw new NotFoundError(`attachment ${id}`);
      return toRow(row);
    });
  },
  /** For entitlement checks (FR-12.2): live receipts and bytes per trip. */
  async usage(db: Db, tripId: string): Promise<{ count: bigint; bytes: bigint }> {
    const [row] = await rawRows<{ count: string; bytes: string }>(db, sql`SELECT count(*)::text AS count, coalesce(sum(bytes), 0)::text AS bytes FROM attachments WHERE trip_id = ${tripId} AND deleted_at IS NULL`);
    return { count: BigInt(row?.count ?? '0'), bytes: BigInt(row?.bytes ?? '0') };
  },
  /**
   * FR-12.6 / D11: receipts past retention. A trip counts from its close (updated_at while
   * closed) or, never closed, from its last entry; the per-trip retention_days applies.
   */
  async expired(db: Db, now: Date): Promise<AttachmentRow[]> {
    const rows = await rawRows<typeof attachments.$inferSelect>(db, sql`
      SELECT a.* FROM attachments a
      JOIN trips t ON t.id = a.trip_id
      WHERE a.deleted_at IS NULL
        AND (CASE WHEN t.status = 'closed' THEN t.updated_at
                  ELSE (SELECT max(e.updated_at) FROM entries e WHERE e.trip_id = t.id) END)
            < ${now}::timestamptz - make_interval(days => t.retention_days)`);
    // raw SQL: timestamps and bigints arrive as strings, unlike the query builder's rows
    return rows.map((r) => toRow({ ...r, uploadedAt: new Date(r.uploadedAt as unknown as string), deletedAt: r.deletedAt ? new Date(r.deletedAt as unknown as string) : null, bytes: BigInt(r.bytes as unknown as string) }));
  },
  async markPurged(db: Db, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.update(attachments).set({ deletedAt: new Date() }).where(sql`${attachments.id} IN ${[...ids]}`);
  },
  /** Attachments whose upload never completed (row exists, no bytes confirmed) can be reaped by the same job. */
  async unconfirmedOlderThan(db: Db, before: Date): Promise<AttachmentRow[]> {
    const rows = await db.query.attachments.findMany({ where: and(isNull(attachments.deletedAt), eq(attachments.bytes, 0n), lt(attachments.uploadedAt, before)) });
    return rows.map(toRow);
  },
};
