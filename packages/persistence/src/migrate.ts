import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Connection, rawRows } from './db';

/**
 * Applies migrations/*.sql in filename order, once each, recording them in
 * schema_migrations. Plain SQL files are the source of truth (A4); Drizzle's
 * own migrator is not used because our migrations contain triggers and
 * functions that its journal format cannot express.
 */
export async function migrate(conn: Connection, dir: string): Promise<string[]> {
  await conn.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const rows = await rawRows<{ name: string }>(conn.db, 'SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const body = readFileSync(join(dir, f), 'utf8');
    await conn.exec(`BEGIN;\n${body}\nINSERT INTO schema_migrations(name) VALUES ('${f.replace(/'/g, "''")}');\nCOMMIT;`);
    applied.push(f);
  }
  return applied;
}
