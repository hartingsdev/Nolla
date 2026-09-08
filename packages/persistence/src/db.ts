import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { type PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { type SQL, sql } from 'drizzle-orm';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
/** Any Drizzle Postgres database or transaction over our schema (pg or PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface Connection {
  readonly db: Db;
  /** Run raw, possibly multi-statement SQL (used by the migration runner). */
  readonly exec: (sql: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

/** Run a raw query and return its rows, whichever driver is underneath (both wrap them in `.rows`). */
export async function rawRows<T>(db: Db, query: SQL | string): Promise<T[]> {
  const res: unknown = await db.execute(typeof query === 'string' ? sql.raw(query) : query);
  if (Array.isArray(res)) return res as T[];
  const rows = (res as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** Production connection over node-postgres. bigint columns come back as JS bigint, numeric as strings. */
export function connect(url: string): Connection {
  const pool = new pg.Pool({ connectionString: url });
  const db: NodePgDatabase<Schema> = drizzlePg(pool, { schema });
  return {
    db,
    exec: async (text) => { await pool.query(text); },
    close: () => pool.end(),
  };
}
