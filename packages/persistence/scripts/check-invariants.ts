// The nightly correctness job (NFR-12). Exits non-zero on any violation so a plain cron alert
// works even before Prometheus scrapes the gauges (observability.md §3.2).
import { checkInvariants, connect } from '../src/index.ts';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }
const conn = connect(url);
try {
  const r = await checkInvariants(conn.db);
  console.log(JSON.stringify(r));
  const bad = r.balanceSum.length + r.entrySum.length + r.closedTripWrite.length;
  process.exit(bad === 0 ? 0 : 1);
} finally {
  await conn.close();
}
