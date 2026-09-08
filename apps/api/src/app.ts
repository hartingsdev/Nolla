import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type Clock } from '@vst/domain';
import { type Db } from '@vst/persistence';
import { type RateLimiter } from './identity/rate-limit.ts';
import { type SessionService } from './identity/sessions.ts';
import { type SignInDeps } from './identity/signin.ts';
import { type IdentityVerifier } from './identity/verifier.ts';
import { type Metrics } from './metrics.ts';
import { type Notifier } from './ports/notifier.ts';
import { authRoutes } from './http/auth-routes.ts';
import { onError } from './http/errors.ts';
import { metricsMiddleware, requestId } from './http/middleware.ts';
import { tripRoutes } from './http/trip-routes.ts';

export interface AppDeps {
  readonly db: Db;
  readonly sessions: SessionService;
  readonly verifier: IdentityVerifier;
  readonly notifier: Notifier;
  readonly clock: Clock;
  readonly limiter: RateLimiter;
  readonly metrics: Metrics;
  readonly appBaseUrl: string;
  /** Browser origins allowed to call the API (the web build). Native apps have no origin. */
  readonly corsOrigins?: readonly string[];
  readonly signInDeps: () => SignInDeps;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use('*', requestId());
  app.use('*', cors({ origin: [...(deps.corsOrigins ?? [])], allowHeaders: ['authorization', 'content-type', 'if-match', 'x-app-version', 'x-platform', 'x-request-id'], exposeHeaders: ['x-request-id'], maxAge: 600 }));
  app.use('*', metricsMiddleware(deps.metrics));
  app.onError(onError(deps.metrics));
  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/', authRoutes(deps));
  app.route('/', tripRoutes(deps));
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  return app;
}

/** The internal metrics listener (observability.md §7): separate port, bearer token, never public. */
export function createMetricsApp(metrics: Metrics, token: string): Hono {
  const app = new Hono();
  app.get('/metrics', async (c) => {
    if (c.req.header('authorization') !== `Bearer ${token}`) return c.text('unauthorized', 401);
    return c.body(await metrics.render(), 200, { 'content-type': metrics.contentType });
  });
  return app;
}
