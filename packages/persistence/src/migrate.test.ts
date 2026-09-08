import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { type Connection, rawRows } from './db';
import { migrate } from './migrate';
import * as schema from './schema';
import { MIGRATIONS_DIR, testConnection } from './testing/harness';

let conn: Connection;
beforeAll(async () => { conn = await testConnection(); });
afterAll(async () => { await conn.close(); });

describe('migrations', () => {
  it('are idempotent', async () => {
    expect(await migrate(conn, MIGRATIONS_DIR)).toEqual([]);
  });

  it('the Drizzle schema mirrors the SQL exactly (every table and column exists, no extras)', async () => {
    const rows = await rawRows<{ table_name: string; column_name: string }>(conn.db, sql`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
    const inDb = new Map<string, Set<string>>();
    for (const r of rows) (inDb.get(r.table_name) ?? inDb.set(r.table_name, new Set()).get(r.table_name))?.add(r.column_name);
    const tables: PgTable[] = [];
    for (const v of Object.values(schema)) if (is(v, PgTable)) tables.push(v);
    expect(tables.length).toBeGreaterThan(10);
    for (const t of tables) {
      const name = getTableName(t);
      const cols = new Set(Object.values(getTableColumns(t)).map((c) => c.name));
      expect(inDb.get(name), `table ${name}`).toBeDefined();
      expect([...cols].sort(), `columns of ${name}`).toEqual([...(inDb.get(name) ?? [])].sort());
    }
  });

  it('has no floating-point column anywhere (P6)', async () => {
    const rows = await rawRows<{ n: number }>(conn.db, sql`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('real', 'double precision')`);
    expect(rows[0]?.n).toBe(0);
  });
});
