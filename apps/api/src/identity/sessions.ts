import { randomUUID } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { type Db, schema } from '@vst/persistence';
import { type Clock } from '@vst/domain';
import { hashToken, newToken } from './tokens.ts';

export const SESSION_TTL_MS = 90 * 24 * 3600 * 1000;      // 90-day sliding expiry (architecture.md §6.2)
const TOUCH_INTERVAL_MS = 6 * 3600 * 1000;               // write last_seen at most every 6 h

export interface SessionService {
  /** `tx` lets a caller create the session inside its own transaction. */
  create(userId: string, tx?: Db): Promise<{ token: string; sessionId: string; expiresAt: Date }>;
  /** Resolve a bearer token to a user id, sliding the expiry. Null when unknown or expired. */
  resolve(token: string): Promise<{ userId: string; sessionId: string } | null>;
  revoke(token: string): Promise<void>;
  revokeAll(userId: string): Promise<void>;
}

export function sessionService(db: Db, clock: Clock): SessionService {
  return {
    async create(userId, tx = db) {
      const token = newToken();
      const sessionId = randomUUID();
      const expiresAt = new Date(clock.nowMs() + SESSION_TTL_MS);
      await tx.insert(schema.sessions).values({ id: sessionId, userId, tokenHash: hashToken(token), expiresAt, lastSeenAt: new Date(clock.nowMs()) });
      return { token, sessionId, expiresAt };
    },
    async resolve(token) {
      const now = new Date(clock.nowMs());
      const row = await db.query.sessions.findFirst({ where: and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, now)) });
      if (!row) return null;
      if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        await db.update(schema.sessions).set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) }).where(eq(schema.sessions.id, row.id));
      }
      return { userId: row.userId, sessionId: row.id };
    },
    async revoke(token) { await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token))); },
    async revokeAll(userId) { await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId)); },
  };
}

/** Housekeeping for the nightly job: drop expired sessions and used/expired magic links. */
export async function purgeExpiredCredentials(db: Db, clock: Clock): Promise<void> {
  const now = new Date(clock.nowMs());
  await db.delete(schema.sessions).where(sql`${schema.sessions.expiresAt} < ${now}`);
  await db.delete(schema.magicLinks).where(sql`${schema.magicLinks.expiresAt} < ${now} OR ${schema.magicLinks.usedAt} IS NOT NULL`);
}
