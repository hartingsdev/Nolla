import { type Context, type MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { routePath } from 'hono/route';
import { type Db, tripRepo } from '@vst/persistence';
import { type SessionService } from '../identity/sessions.ts';
import { type Metrics } from '../metrics.ts';

export interface AuthVars { userId: string; sessionId: string; token: string }
export interface TripVars extends AuthVars { tripId: string; role: 'member' | 'admin' }

/** RED metrics + client version labels (observability.md §3.1, §3.6). */
export function metricsMiddleware(metrics: Metrics): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    metrics.http.inFlight(1);
    try { await next(); } finally {
      metrics.http.inFlight(-1);
      const client = { appVersion: c.req.header('x-app-version') ?? 'unknown', platform: c.req.header('x-platform') ?? 'unknown' };
      metrics.http.observe(routePath(c) || c.req.path, c.req.method, c.res.status, (performance.now() - start) / 1000, client);
    }
  };
}

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.header('x-request-id', id);
    await next();
  };
}

/** Bearer session token → user. 401 otherwise. */
export function auth(sessions: SessionService): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const h = c.req.header('authorization') ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const s = token ? await sessions.resolve(token) : null;
    if (!s) throw new HTTPException(401, { message: 'sign in required' });
    c.set('userId', s.userId); c.set('sessionId', s.sessionId); c.set('token', token);
    await next();
  };
}

/**
 * :tripId → membership, or 404 (never 403, so trip ids cannot be probed — NFR-5). The only
 * place membership is checked; every repository call below it is trip-keyed (NFR-14).
 */
export function tripScope(db: Db, metrics: Metrics): MiddlewareHandler<{ Variables: TripVars }> {
  return async (c, next) => {
    const tripId = c.req.param('tripId') ?? '';
    const role = /^[0-9a-f-]{36}$/i.test(tripId) ? await tripRepo.role(db, tripId, c.get('userId')) : null;
    if (!role) { metrics.scopeDenied(); throw new HTTPException(404, { message: 'not found' }); }
    c.set('tripId', tripId); c.set('role', role);
    await next();
  };
}

export function requireAdmin(c: Context<{ Variables: TripVars }>): void {
  if (c.get('role') !== 'admin') throw new HTTPException(403, { message: 'admin only' });
}
