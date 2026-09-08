import { eq } from 'drizzle-orm';
import { type Db } from '../db';
import { authIdentities, magicLinks, memberships, participants, sessions, users } from '../schema';

export interface UserRow { readonly id: string; readonly email: string | null; readonly displayName: string | null; readonly plan: string; readonly deletedAt: Date | null }

export const userRepo = {
  async create(db: Db, input: { id: string; email?: string | null; displayName?: string | null }): Promise<UserRow> {
    const [row] = await db.insert(users).values({ id: input.id, email: input.email ?? null, displayName: input.displayName ?? null }).returning();
    const r = row as typeof users.$inferSelect;
    return { id: r.id, email: r.email, displayName: r.displayName, plan: r.plan, deletedAt: r.deletedAt };
  },

  async get(db: Db, id: string): Promise<UserRow | null> {
    const r = await db.query.users.findFirst({ where: eq(users.id, id) });
    return r ? { id: r.id, email: r.email, displayName: r.displayName, plan: r.plan, deletedAt: r.deletedAt } : null;
  },

  async linkIdentity(db: Db, userId: string, provider: 'apple' | 'google' | 'email', subject: string): Promise<void> {
    await db.insert(authIdentities).values({ userId, provider, subject }).onConflictDoNothing();
  },

  async findByIdentity(db: Db, provider: 'apple' | 'google' | 'email', subject: string): Promise<string | null> {
    const r = await db.query.authIdentities.findFirst({ where: (t, { and, eq }) => and(eq(t.provider, provider), eq(t.subject, subject)) });
    return r?.userId ?? null;
  },

  /**
   * FR-1.9 account deletion, as one transaction: personal data and credentials go, the
   * ledger stays. Participants owned by the user are tombstoned (name kept, identity
   * detached), so every other member's balance is unchanged (I2).
   */
  async deleteAccount(db: Db, userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const u = await tx.query.users.findFirst({ where: eq(users.id, userId) });
      if (!u) return;
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.delete(authIdentities).where(eq(authIdentities.userId, userId));
      if (u.email) await tx.delete(magicLinks).where(eq(magicLinks.email, u.email));
      await tx.update(participants).set({ userId: null, tombstonedAt: new Date() }).where(eq(participants.userId, userId));
      await tx.delete(memberships).where(eq(memberships.userId, userId));
      await tx.update(users).set({ email: null, displayName: null, deletedAt: new Date() }).where(eq(users.id, userId));
    });
  },
};
