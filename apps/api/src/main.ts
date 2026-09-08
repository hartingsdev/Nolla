import { serve } from '@hono/node-server';
import { connect, migrate } from '@vst/persistence';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, createMetricsApp } from './app.ts';
import { smtpNotifier } from './adapters/notifier-smtp.ts';
import { MemoryRateLimiter } from './identity/rate-limit.ts';
import { sessionService } from './identity/sessions.ts';
import { OidcVerifier, defaultProviderConfigs } from './identity/verifier.ts';
import { promMetrics } from './metrics.ts';
import { systemClock } from './ports/clock.ts';
import { RecordingNotifier } from './ports/notifier.ts';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) { console.error(`missing env ${name}`); process.exit(2); }
  return v;
}
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

const conn = connect(env('DATABASE_URL'));
// Repo layout: apps/api/src/main.ts → ../../../packages/persistence/migrations. Bundled: /app/main.mjs → ./packages/persistence/migrations.
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = process.env.MIGRATIONS_DIR ?? (existsSync(join(here, 'packages')) ? join(here, 'packages', 'persistence', 'migrations') : join(here, '..', '..', '..', 'packages', 'persistence', 'migrations'));
await migrate(conn, migrationsDir);

const metrics = promMetrics();
const clock = systemClock;
const sessions = sessionService(conn.db, clock);
const verifier = new OidcVerifier(defaultProviderConfigs({ appleAudiences: list(env('APPLE_AUDIENCES', '')), googleAudiences: list(env('GOOGLE_AUDIENCES', '')) }), () => clock.nowMs());
const smtp = process.env.SMTP_URL;
const notifier = smtp ? smtpNotifier(smtp, env('MAIL_FROM', 'Trip Ledger <no-reply@example.com>')) : new RecordingNotifier();
const limiter = new MemoryRateLimiter(10, 60_000);
const appBaseUrl = env('APP_BASE_URL', 'http://localhost:8081');
const corsOrigins = list(env('CORS_ORIGINS', appBaseUrl));

const deps = {
  db: conn.db, sessions, verifier, notifier, clock, limiter, metrics, appBaseUrl, corsOrigins,
  signInDeps: () => ({
    db: conn.db, verifier, sessions, notifier, clock, limiter, appBaseUrl,
    t: (k: 'magicLink.subject' | 'magicLink.body', v: { url: string }) => (k === 'magicLink.subject' ? 'Your Trip Ledger sign-in link' : `Open this link to sign in (valid 15 minutes):\n\n${v.url}`),
  }),
};

const port = Number(env('PORT', '8080'));
const metricsPort = Number(env('METRICS_PORT', '9464'));
serve({ fetch: createApp(deps).fetch, port }, () => { console.log(JSON.stringify({ level: 'info', msg: 'api listening', port })); });
serve({ fetch: createMetricsApp(metrics, env('METRICS_TOKEN', 'dev-metrics-token')).fetch, port: metricsPort }, () => { console.log(JSON.stringify({ level: 'info', msg: 'metrics listening', port: metricsPort })); });
