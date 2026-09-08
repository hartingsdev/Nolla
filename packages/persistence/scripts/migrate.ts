// Apply pending migrations to DATABASE_URL. Used by deploys and by `pnpm --filter @vst/persistence migrate`.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, migrate } from '../src/index.ts';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }
const conn = connect(url);
try {
  const applied = await migrate(conn, join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
} finally {
  await conn.close();
}
