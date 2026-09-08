/**
 * The real API on an in-process Postgres (PGlite): no Docker, no DATABASE_URL.
 * For local app development and the UI e2e suite. Adds ONE dev-only route,
 * GET /dev/magic-links, that returns the links the RecordingNotifier captured,
 * so a browser test can complete the e-mail sign-in without an inbox.
 *
 *   pnpm --filter @vst/api dev:pglite            # API :8080, metrics :9464
 */
import { serve } from '@hono/node-server';
import { testConnection } from '@vst/persistence/testing';
import { createApp, createMetricsApp } from '../src/app.ts';
import { MemoryRateLimiter } from '../src/identity/rate-limit.ts';
import { sessionService } from '../src/identity/sessions.ts';
import { type IdentityVerifier, IdentityError, type Provider, type VerifiedIdentity } from '../src/identity/verifier.ts';
import { promMetrics } from '../src/metrics.ts';
import { systemClock } from '../src/ports/clock.ts';
import { RecordingNotifier } from '../src/ports/notifier.ts';

/** Dev verifier: a "token" of the form `google|subject|email` is accepted as-is. Never used in production builds. */
class DevVerifier implements IdentityVerifier {
  verify(provider: Provider, token: string): Promise<VerifiedIdentity> {
    const [p, subject, email] = token.split('|');
    if (p !== provider || !subject) return Promise.reject(new IdentityError('INVALID_TOKEN', 'dev token must be provider|subject|email'));
    return Promise.resolve({ provider, subject, ...(email ? { email } : {}) });
  }
}

const conn = await testConnection();
const metrics = promMetrics();
const clock = systemClock;
const sessions = sessionService(conn.db, clock);
const verifier = new DevVerifier();
const notifier = new RecordingNotifier();
const limiter = new MemoryRateLimiter(1000, 60_000);
const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:8081';
const corsOrigins = (process.env.CORS_ORIGINS ?? `${appBaseUrl},http://localhost:8787,http://localhost:19006`).split(',');

const app = createApp({
  db: conn.db, sessions, verifier, notifier, clock, limiter, metrics, appBaseUrl, corsOrigins,
  signInDeps: () => ({ db: conn.db, verifier, sessions, notifier, clock, limiter, appBaseUrl, t: (k, v) => (k === 'magicLink.subject' ? 'Sign in' : v.url) }),
});
app.get('/dev/magic-links', (c) => c.json({ links: notifier.emails.map((e) => ({ to: e.to, url: e.text })) }));

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () => { console.log(`[dev-pglite] api on http://localhost:${String(port)} (magic links: /dev/magic-links)`); });
serve({ fetch: createMetricsApp(metrics, process.env.METRICS_TOKEN ?? 'dev-metrics-token').fetch, port: Number(process.env.METRICS_PORT ?? 9464) });
