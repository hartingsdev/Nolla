import { type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { routePath } from 'hono/route';
import { DomainError } from '@vst/domain';
import { ConflictError, ForbiddenWriteError, NotFoundError } from '@vst/persistence';
import { IdentityError } from '../identity/verifier.ts';
import { type Metrics } from '../metrics.ts';
import { jsonBig } from './json.ts';

export interface ApiErrorBody { error: { code: string; message: string; current?: unknown } }

/** One place maps every error type to a status (architecture.md §6). */
export function onError(metrics: Metrics) {
  return (err: unknown, c: Context): Response => {
    const route = routePath(c);
    if (err instanceof HTTPException) {
      const code = ({ 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'UNPROCESSABLE', 428: 'PRECONDITION_REQUIRED' } as Record<number, string>)[err.status] ?? 'ERROR';
      return jsonBig(c, { error: { code, message: err.message } }, err.status);
    }
    if (err instanceof DomainError) { metrics.validationFailure(err.code); return c.json<ApiErrorBody>({ error: { code: err.code, message: err.message } }, 422); }
    if (err instanceof ConflictError) { metrics.writeConflict(route); return jsonBig(c, { error: { code: 'CONFLICT', message: err.message, current: err.current as unknown } }, 409); }
    if (err instanceof NotFoundError) return c.json<ApiErrorBody>({ error: { code: 'NOT_FOUND', message: err.message } }, 404);
    if (err instanceof ForbiddenWriteError) return c.json<ApiErrorBody>({ error: { code: 'TRIP_LOCKED', message: err.message } }, 409);
    if (err instanceof IdentityError) return c.json<ApiErrorBody>({ error: { code: err.code, message: err.message } }, 401);
    console.error(JSON.stringify({ level: 'error', route, message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }));
    return c.json<ApiErrorBody>({ error: { code: 'INTERNAL', message: 'internal error' } }, 500);
  };
}
