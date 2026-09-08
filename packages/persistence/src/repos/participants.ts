import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { type Db } from '../db';
import { ForbiddenWriteError, NotFoundError } from '../errors';
import { participants, payments, shares } from '../schema';
import { nextSeq, tripRepo } from './trips';

export interface ParticipantRow {
  readonly id: string; readonly tripId: string; readonly displayName: string; readonly userId: string | null;
  readonly joinedAt: string; readonly leftAt: string | null; readonly tombstonedAt: Date | null; readonly seq: bigint;
}

const toRow = (p: typeof participants.$inferSelect): ParticipantRow => ({
  id: p.id, tripId: p.tripId, displayName: p.displayName, userId: p.userId, joinedAt: p.joinedAt, leftAt: p.leftAt, tombstonedAt: p.tombstonedAt, seq: p.seq,
});

export const participantRepo = {
  /**
   * Add a participant; `userId` null = placeholder (FR-1.3).
   *
   * Idempotent on the client-generated id: the outbox delivers at least once
   * (A7), so a round that pushed this write and then lost the response will
   * push it again. Re-inserting would fail on the primary key and the client
   * would drop a write it believes landed, so a repeat returns the row that is
   * already there — including on a trip that has since been closed, since the
   * write itself already happened.
   */
  async add(db: Db, input: { id: string; tripId: string; displayName: string; userId?: string | null; joinedAt: string }): Promise<ParticipantRow> {
    return db.transaction(async (tx) => {
      const existing = await tx.query.participants.findFirst({ where: eq(participants.id, input.id) });
      if (existing) {
        if (existing.tripId !== input.tripId) throw new NotFoundError(`participant ${input.id}`);
        return toRow(existing);
      }
      await tripRepo.assertWritable(tx, input.tripId, 'membership');
      const seq = await nextSeq(tx, input.tripId);
      const [row] = await tx.insert(participants).values({ id: input.id, tripId: input.tripId, displayName: input.displayName, userId: input.userId ?? null, joinedAt: input.joinedAt, seq }).returning();
      return toRow(row as typeof participants.$inferSelect);
    });
  },

  async list(db: Db, tripId: string): Promise<ParticipantRow[]> {
    const rows = await db.query.participants.findMany({ where: eq(participants.tripId, tripId), orderBy: participants.createdAt });
    return rows.map(toRow);
  },

  /** Claim a placeholder for a user (FR-1.11): all history follows because shares/payments point at the participant. */
  async claim(db: Db, tripId: string, participantId: string, userId: string): Promise<ParticipantRow> {
    return db.transaction(async (tx) => {
      const p = await tx.query.participants.findFirst({ where: and(eq(participants.id, participantId), eq(participants.tripId, tripId)) });
      if (!p) throw new NotFoundError(`participant ${participantId}`);
      if (p.userId !== null) throw new ForbiddenWriteError('participant is already claimed');
      const seq = await nextSeq(tx, tripId);
      const [row] = await tx.update(participants).set({ userId, tombstonedAt: null, seq }).where(eq(participants.id, participantId)).returning();
      return toRow(row as typeof participants.$inferSelect);
    });
  },

  /** FR-1.6: only participants without ledger references can be removed. */
  async remove(db: Db, tripId: string, participantId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tripRepo.assertWritable(tx, tripId, 'membership');
      const [ref] = await tx.select({ n: sql<number>`count(*)::int` }).from(payments).where(eq(payments.participantId, participantId));
      const [ref2] = await tx.select({ n: sql<number>`count(*)::int` }).from(shares).where(eq(shares.participantId, participantId));
      if ((ref?.n ?? 0) + (ref2?.n ?? 0) > 0) throw new ForbiddenWriteError('participant has ledger entries; settle first');
      await nextSeq(tx, tripId);
      await tx.delete(participants).where(and(eq(participants.id, participantId), eq(participants.tripId, tripId)));
    });
  },

  async changesSince(db: Db, tripId: string, since: bigint): Promise<ParticipantRow[]> {
    const rows = await db.query.participants.findMany({ where: and(eq(participants.tripId, tripId), gt(participants.seq, since)), orderBy: participants.seq });
    return rows.map(toRow);
  },

  /** Participants a user can be split against by default: present and not left (FR-3.1). */
  async active(db: Db, tripId: string): Promise<ParticipantRow[]> {
    const rows = await db.query.participants.findMany({ where: and(eq(participants.tripId, tripId), or(isNull(participants.leftAt))) });
    return rows.map(toRow);
  },
};
