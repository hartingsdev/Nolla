/**
 * Receipt retention job (FR-12.6, D11). Deletes receipts past their trip's retention and
 * reaps rows whose upload never completed. Exits non-zero on partial failure so a cron
 * alert exists before Prometheus scrapes anything (observability.md §3.2).
 *
 *   DATABASE_URL=… S3_BUCKET=… tsx scripts/retention.ts [--dry-run]
 */
import { attachmentRepo, connect } from '@vst/persistence';
import { s3BlobStore } from '../src/adapters/blob-s3.ts';
import { LocalBlobStore } from '../src/ports/blob.ts';

const dryRun = process.argv.includes('--dry-run');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }

const conn = connect(url);
const blobs = process.env.S3_BUCKET
  ? s3BlobStore({
      bucket: process.env.S3_BUCKET, region: process.env.S3_REGION ?? 'auto',
      accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    })
  : new LocalBlobStore('http://localhost', 'unused');

let failures = 0;
try {
  const now = new Date();
  const expired = await attachmentRepo.expired(conn.db, now);
  // An upload that never confirmed after a day is abandoned; its blob may or may not exist.
  const abandoned = await attachmentRepo.unconfirmedOlderThan(conn.db, new Date(now.getTime() - 24 * 3600 * 1000));
  const doomed = [...expired, ...abandoned];
  console.log(JSON.stringify({ expired: expired.length, abandoned: abandoned.length, dryRun }));
  if (!dryRun) {
    const purged: string[] = [];
    for (const a of doomed) {
      try { await blobs.delete(a.blobKey); purged.push(a.id); }
      catch (e) { failures++; console.error(JSON.stringify({ level: 'error', attachment: a.id, message: e instanceof Error ? e.message : String(e) })); }
    }
    // Only rows whose bytes are actually gone are marked purged, so a failure retries tomorrow.
    await attachmentRepo.markPurged(conn.db, purged);
    console.log(JSON.stringify({ purged: purged.length, failures }));
  }
} finally {
  await conn.close();
}
process.exit(failures === 0 ? 0 : 1);
