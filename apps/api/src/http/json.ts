import { type Context } from 'hono';
import { type ContentfulStatusCode } from 'hono/utils/http-status';

/** JSON with bigint → string (seq, version counters). Money is already a string on the wire (P6). */
export function jsonBig(c: Context, data: unknown, status: ContentfulStatusCode = 200): Response {
  return c.body(JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)), status, { 'content-type': 'application/json; charset=utf-8' });
}
