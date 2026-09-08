import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { eq } from 'drizzle-orm';
import { type Connection, schema, userRepo } from '@vst/persistence';
import { testConnection } from '@vst/persistence/testing';
import { fixedClock } from '../ports/clock.ts';
import { RecordingNotifier } from '../ports/notifier.ts';
import { MemoryRateLimiter } from './rate-limit.ts';
import { SESSION_TTL_MS, purgeExpiredCredentials, sessionService } from './sessions.ts';
import { type SignInDeps, MAGIC_LINK_TTL_MS, deleteAccount, requestMagicLink, signInWithProvider, verifyMagicLink } from './signin.ts';
import { hashToken, newToken } from './tokens.ts';
import { IdentityError, OidcVerifier } from './verifier.ts';

let conn: Connection;
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let keys: { apple: PrivateKey; google: PrivateKey };
let verifier: OidcVerifier;
const clock = fixedClock('2026-09-08T10:00:00Z');

async function mint(provider: 'apple' | 'google', claims: Record<string, unknown>, opts: { iss?: string; aud?: string; key?: PrivateKey; exp?: number } = {}): Promise<string> {
  const iss = opts.iss ?? (provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com');
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: provider }).setIssuer(iss).setAudience(opts.aud ?? `${provider}-client`)
    .setIssuedAt(Math.floor(clock.nowMs() / 1000)).setExpirationTime(opts.exp ?? Math.floor(clock.nowMs() / 1000) + 600).sign(opts.key ?? keys[provider]);
}

beforeAll(async () => {
  conn = await testConnection();
  const a = await generateKeyPair('RS256'); const g = await generateKeyPair('RS256');
  keys = { apple: a.privateKey, google: g.privateKey };
  const jwks = { keys: [{ ...(await exportJWK(a.publicKey)), kid: 'apple', alg: 'RS256' }, { ...(await exportJWK(g.publicKey)), kid: 'google', alg: 'RS256' }] };
  verifier = new OidcVerifier({
    apple: { issuer: 'https://appleid.apple.com', audiences: ['apple-client'], keys: createLocalJWKSet(jwks) },
    google: { issuer: ['https://accounts.google.com', 'accounts.google.com'], audiences: ['google-client'], keys: createLocalJWKSet(jwks) },
  }, () => clock.nowMs());
});
afterAll(async () => { await conn.close(); });

function deps(): SignInDeps & { notifier: RecordingNotifier } {
  const notifier = new RecordingNotifier();
  return {
    db: conn.db, verifier, sessions: sessionService(conn.db, clock), notifier, clock, limiter: new MemoryRateLimiter(5, 60_000, () => clock.nowMs()),
    appBaseUrl: 'https://app.test', t: (k, v) => (k === 'magicLink.subject' ? 'Sign in' : `Open ${v.url}`),
  };
}

describe('OIDC verifier', () => {
  it('accepts a valid token and returns subject + verified email', async () => {
    const id = await verifier.verify('google', await mint('google', { sub: 'g-1', email: 'Max@Example.com', email_verified: true }));
    expect(id).toEqual({ provider: 'google', subject: 'g-1', email: 'max@example.com' });
  });
  it('drops an unverified email', async () => {
    const id = await verifier.verify('apple', await mint('apple', { sub: 'a-1', email: 'x@y.z', email_verified: false }));
    expect(id.email).toBeUndefined();
  });
  it('rejects wrong audience, wrong issuer, wrong key and expired tokens', async () => {
    await expect(verifier.verify('google', await mint('google', { sub: 'g' }, { aud: 'other' }))).rejects.toMatchObject({ code: 'WRONG_AUDIENCE' });
    await expect(verifier.verify('google', await mint('google', { sub: 'g' }, { iss: 'https://evil.example' }))).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(verifier.verify('google', await mint('google', { sub: 'g' }, { key: keys.apple }))).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(verifier.verify('google', await mint('google', { sub: 'g' }, { exp: Math.floor(clock.nowMs() / 1000) - 3600 }))).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(verifier.verify('apple', 'not.a.jwt')).rejects.toBeInstanceOf(IdentityError);
  });
  it('an Apple token cannot be replayed as a Google one', async () => {
    await expect(verifier.verify('google', await mint('apple', { sub: 'a' }))).rejects.toBeInstanceOf(IdentityError);
  });
});

describe('sign in with a provider', () => {
  it('creates a user on first sign-in, reuses it afterwards, and issues a resolvable session', async () => {
    const d = deps();
    const first = await signInWithProvider(d, 'apple', await mint('apple', { sub: 'a-100', email: 'r@t.de', email_verified: true }), '1.1.1.1');
    expect(first.isNewUser).toBe(true);
    const again = await signInWithProvider(d, 'apple', await mint('apple', { sub: 'a-100' }), '1.1.1.1');
    expect(again.userId).toBe(first.userId); expect(again.isNewUser).toBe(false);
    expect(again.token).not.toBe(first.token);
    expect(await d.sessions.resolve(first.token)).toMatchObject({ userId: first.userId });
    expect(await d.sessions.resolve('nope')).toBeNull();
  });
  it('links a second provider to the same user via a verified e-mail', async () => {
    const d = deps();
    const a = await signInWithProvider(d, 'apple', await mint('apple', { sub: 'a-200', email: 'same@t.de', email_verified: true }), '1.1.1.1');
    const g = await signInWithProvider(d, 'google', await mint('google', { sub: 'g-200', email: 'same@t.de', email_verified: true }), '1.1.1.1');
    expect(g.userId).toBe(a.userId); expect(g.isNewUser).toBe(false);
    expect(await userRepo.findByIdentity(conn.db, 'google', 'g-200')).toBe(a.userId);
  });
  it('an unverified e-mail never links accounts', async () => {
    const d = deps();
    const a = await signInWithProvider(d, 'apple', await mint('apple', { sub: 'a-300', email: 'v@t.de', email_verified: true }), '1.1.1.1');
    const g = await signInWithProvider(d, 'google', await mint('google', { sub: 'g-300', email: 'v@t.de', email_verified: false }), '1.1.1.1');
    expect(g.userId).not.toBe(a.userId);
  });
  it('is rate limited per ip', async () => {
    const d = deps();
    for (let i = 0; i < 5; i++) await signInWithProvider(d, 'apple', await mint('apple', { sub: `rl-${String(i)}` }), '9.9.9.9');
    await expect(signInWithProvider(d, 'apple', await mint('apple', { sub: 'rl-x' }), '9.9.9.9')).rejects.toThrow(/rate limited/);
  });
});

describe('magic links', () => {
  let d: ReturnType<typeof deps>;
  beforeEach(() => { d = deps(); });

  it('sends a link with a one-time token, which signs the user in exactly once', async () => {
    await requestMagicLink(d, ' Lena@Test.de ', '2.2.2.2');
    expect(d.notifier.emails).toHaveLength(1);
    const url = new URL(/https:\S+/.exec(d.notifier.emails[0]!.text)![0]);
    const token = url.searchParams.get('token')!;
    expect(url.origin + url.pathname).toBe('https://app.test/auth/email');
    const r = await verifyMagicLink(d, token);
    expect(r.isNewUser).toBe(true);
    expect((await userRepo.get(conn.db, r.userId))?.email).toBe('lena@test.de');
    await expect(verifyMagicLink(d, token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' }); // used
  });
  it('the raw token is never stored', async () => {
    await requestMagicLink(d, 'raw@t.de', '2.2.2.2');
    const token = new URL(/https:\S+/.exec(d.notifier.emails[0]!.text)![0]).searchParams.get('token')!;
    const rows = await conn.db.select().from(schema.magicLinks);
    expect(rows.some((r) => Buffer.from(r.tokenHash).equals(hashToken(token)))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
  it('expires', async () => {
    await requestMagicLink(d, 'late@t.de', '2.2.2.2');
    const token = new URL(/https:\S+/.exec(d.notifier.emails[0]!.text)![0]).searchParams.get('token')!;
    clock.set(new Date(clock.nowMs() + MAGIC_LINK_TTL_MS + 1000).toISOString());
    await expect(verifyMagicLink(d, token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    clock.set('2026-09-08T10:00:00Z');
  });
  it('silently ignores garbage and rate-limited addresses (no enumeration)', async () => {
    await requestMagicLink(d, 'not-an-email', '3.3.3.3');
    for (let i = 0; i < 7; i++) await requestMagicLink(d, 'spam@t.de', '3.3.3.3');
    expect(d.notifier.emails.length).toBeLessThanOrEqual(5);
  });
  it('links to an existing provider user with the same e-mail', async () => {
    const a = await signInWithProvider(d, 'apple', await mint('apple', { sub: 'a-400', email: 'both@t.de', email_verified: true }), '1.1.1.1');
    await requestMagicLink(d, 'both@t.de', '2.2.2.2');
    const token = new URL(/https:\S+/.exec(d.notifier.emails[0]!.text)![0]).searchParams.get('token')!;
    const r = await verifyMagicLink(d, token);
    expect(r.userId).toBe(a.userId); expect(r.isNewUser).toBe(false);
  });
});

describe('sessions', () => {
  it('slide their expiry on use and expire when unused', async () => {
    const d = deps();
    const { token } = await d.sessions.create((await userRepo.create(conn.db, { id: crypto.randomUUID() })).id);
    clock.set(new Date(clock.nowMs() + SESSION_TTL_MS - 24 * 3600 * 1000).toISOString()); // day 89: still valid, gets extended
    expect(await d.sessions.resolve(token)).not.toBeNull();
    clock.set(new Date(clock.nowMs() + 60 * 24 * 3600 * 1000).toISOString());            // 60 days later: extended session still valid
    expect(await d.sessions.resolve(token)).not.toBeNull();
    clock.set(new Date(clock.nowMs() + SESSION_TTL_MS + 1000).toISOString());             // then unused past the ttl
    expect(await d.sessions.resolve(token)).toBeNull();
    clock.set('2026-09-08T10:00:00Z');
  });
  it('revoke and revokeAll', async () => {
    const d = deps();
    const userId = (await userRepo.create(conn.db, { id: crypto.randomUUID() })).id;
    const s1 = await d.sessions.create(userId); const s2 = await d.sessions.create(userId);
    await d.sessions.revoke(s1.token);
    expect(await d.sessions.resolve(s1.token)).toBeNull(); expect(await d.sessions.resolve(s2.token)).not.toBeNull();
    await d.sessions.revokeAll(userId);
    expect(await d.sessions.resolve(s2.token)).toBeNull();
  });
  it('purge removes expired sessions and consumed magic links', async () => {
    const d = deps();
    const userId = (await userRepo.create(conn.db, { id: crypto.randomUUID() })).id;
    await d.sessions.create(userId);
    await conn.db.insert(schema.magicLinks).values({ tokenHash: hashToken(newToken()), email: 'p@t.de', expiresAt: new Date(clock.nowMs() - 1000) });
    clock.set(new Date(clock.nowMs() + SESSION_TTL_MS + 1000).toISOString());
    await purgeExpiredCredentials(conn.db, clock);
    expect(await conn.db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId))).toHaveLength(0);
    expect(await conn.db.select().from(schema.magicLinks).where(eq(schema.magicLinks.email, 'p@t.de'))).toHaveLength(0);
    clock.set('2026-09-08T10:00:00Z');
  });
});

describe('account deletion (FR-1.9)', () => {
  it('kills every session and detaches identities; signing in again creates a fresh user', async () => {
    const d = deps();
    const first = await signInWithProvider(d, 'google', await mint('google', { sub: 'g-del', email: 'del@t.de', email_verified: true }), '1.1.1.1');
    await deleteAccount(d, first.userId);
    expect(await d.sessions.resolve(first.token)).toBeNull();
    expect((await userRepo.get(conn.db, first.userId))?.email).toBeNull();
    const again = await signInWithProvider(d, 'google', await mint('google', { sub: 'g-del', email: 'del@t.de', email_verified: true }), '1.1.1.1');
    expect(again.isNewUser).toBe(true); expect(again.userId).not.toBe(first.userId);
  });
});
