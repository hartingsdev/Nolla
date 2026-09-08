import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { type Db, schema, userRepo } from '@vst/persistence';
import { type Clock } from '@vst/domain';
import { type Notifier } from '../ports/notifier.ts';
import { type RateLimiter } from './rate-limit.ts';
import { type SessionService } from './sessions.ts';
import { hashToken, newToken } from './tokens.ts';
import { type IdentityVerifier, IdentityError, type Provider } from './verifier.ts';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export interface SignInResult { readonly userId: string; readonly token: string; readonly isNewUser: boolean }

export interface SignInDeps {
  readonly db: Db;
  readonly verifier: IdentityVerifier;
  readonly sessions: SessionService;
  readonly notifier: Notifier;
  readonly clock: Clock;
  readonly limiter: RateLimiter;
  /** e.g. https://app.example.com — magic links are `${appBaseUrl}/auth/email?token=…`, a universal link. */
  readonly appBaseUrl: string;
  readonly t: (key: 'magicLink.subject' | 'magicLink.body', vars: { url: string }) => string;
}

/**
 * Sign in with Apple or Google. One internal user may hold several identities;
 * a verified e-mail from the provider links to an existing user with that
 * e-mail (D2, architecture.md §6.2).
 */
export async function signInWithProvider(deps: SignInDeps, provider: Provider, token: string, ip: string): Promise<SignInResult> {
  if (!deps.limiter.hit(`provider:${ip}`)) throw new IdentityError('INVALID_TOKEN', 'rate limited');
  const id = await deps.verifier.verify(provider, token);
  return deps.db.transaction(async (tx) => {
    let userId = await userRepo.findByIdentity(tx, provider, id.subject);
    let isNewUser = false;
    if (!userId && id.email) {
      const byEmail = await tx.query.users.findFirst({ where: and(eq(schema.users.email, id.email), isNull(schema.users.deletedAt)) });
      if (byEmail) { userId = byEmail.id; await userRepo.linkIdentity(tx, userId, provider, id.subject); }
    }
    if (!userId) {
      userId = randomUUID();
      await userRepo.create(tx, { id: userId, email: id.email ?? null });
      await userRepo.linkIdentity(tx, userId, provider, id.subject);
      isNewUser = true;
    }
    const session = await deps.sessions.create(userId, tx);
    return { userId, token: session.token, isNewUser };
  });
}

/** Always resolves, even for unknown addresses, so the endpoint cannot be used to enumerate users. */
export async function requestMagicLink(deps: SignInDeps, emailRaw: string, ip: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  if (!deps.limiter.hit(`magic:${email}`) || !deps.limiter.hit(`magic-ip:${ip}`)) return;
  const token = newToken();
  await deps.db.insert(schema.magicLinks).values({ tokenHash: hashToken(token), email, expiresAt: new Date(deps.clock.nowMs() + MAGIC_LINK_TTL_MS) });
  const url = `${deps.appBaseUrl}/auth/email?token=${encodeURIComponent(token)}`;
  await deps.notifier.sendEmail({ to: email, subject: deps.t('magicLink.subject', { url }), text: deps.t('magicLink.body', { url }) });
}

export async function verifyMagicLink(deps: SignInDeps, token: string): Promise<SignInResult> {
  const now = new Date(deps.clock.nowMs());
  return deps.db.transaction(async (tx) => {
    const [row] = await tx.update(schema.magicLinks).set({ usedAt: now })
      .where(and(eq(schema.magicLinks.tokenHash, hashToken(token)), isNull(schema.magicLinks.usedAt)))
      .returning();
    if (!row || row.expiresAt.getTime() < now.getTime()) throw new IdentityError('INVALID_TOKEN', 'magic link invalid or expired');
    let userId = await userRepo.findByIdentity(tx, 'email', row.email);
    let isNewUser = false;
    if (!userId) {
      const existing = await tx.query.users.findFirst({ where: and(eq(schema.users.email, row.email), isNull(schema.users.deletedAt)) });
      userId = existing?.id ?? randomUUID();
      if (!existing) { await userRepo.create(tx, { id: userId, email: row.email }); isNewUser = true; }
      await userRepo.linkIdentity(tx, userId, 'email', row.email);
    }
    const session = await deps.sessions.create(userId, tx);
    return { userId, token: session.token, isNewUser };
  });
}

/** FR-1.9: delete the account and every session; the ledger stays (persistence handles the tombstoning). */
export async function deleteAccount(deps: Pick<SignInDeps, 'db' | 'sessions'>, userId: string): Promise<void> {
  await deps.sessions.revokeAll(userId);
  await userRepo.deleteAccount(deps.db, userId);
}
