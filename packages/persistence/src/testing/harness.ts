import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { type Connection, connect } from '../db';
import { migrate } from '../migrate';
import * as schema from '../schema';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

/**
 * A migrated database for tests. With DATABASE_URL set (CI), a real Postgres is used and the
 * public schema is reset first; otherwise PGlite runs Postgres in-process — same SQL, same
 * triggers, no Docker.
 */
export async function testConnection(): Promise<Connection> {
  const url = process.env.DATABASE_URL;
  let conn: Connection;
  if (url) {
    conn = connect(url);
    await conn.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } else {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    conn = { db, exec: async (text) => { await client.exec(text); }, close: () => client.close() };
  }
  await migrate(conn, MIGRATIONS_DIR);
  return conn;
}
