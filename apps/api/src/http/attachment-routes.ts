import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { RECEIPT_MAX_BYTES, createAttachment } from '@vst/contracts';
import { check, effectiveRetentionDays, resolveLimits } from '@vst/domain';
import { attachmentRepo, entryRepo, tripRepo, userRepo } from '@vst/persistence';
import { type AppDeps } from '../app.ts';
import { LocalBlobStore } from '../ports/blob.ts';
import { auth, tripScope, type TripVars } from './middleware.ts';
import { jsonBig } from './json.ts';

const UPLOAD_TTL = 300;      // 5 minutes to complete an upload
const DOWNLOAD_TTL = 900;    // 15 minutes to view a receipt

/**
 * Receipts (FR-2.5). Bytes never pass through the API in production: the client asks for a
 * presigned PUT, uploads straight to object storage, then confirms. An unconfirmed row is
 * reaped by the retention job, so a failed upload leaves no dangling reference.
 */
export function attachmentRoutes(deps: AppDeps) {
  const app = new Hono<{ Variables: TripVars }>();
  const { db, blobs } = deps;

  app.use('/trips/:tripId/entries/:eid/attachments', auth(deps.sessions), tripScope(db, deps.metrics));
  app.use('/trips/:tripId/entries/:eid/attachments/*', auth(deps.sessions), tripScope(db, deps.metrics));
  app.use('/trips/:tripId/attachments/*', auth(deps.sessions), tripScope(db, deps.metrics));

  const key = (tripId: string, id: string) => `trips/${tripId}/receipts/${id}`;

  /** Step 1: reserve the row and hand back a presigned PUT. */
  app.post('/trips/:tripId/entries/:eid/attachments', zValidator('json', createAttachment), async (c) => {
    const body = c.req.valid('json');
    const tripId = c.get('tripId');
    const entryId = c.req.param('eid');
    await entryRepo.get(db, tripId, entryId); // 404s for another trip's entry

    // FR-12.1/12.2: the trip creator's plan governs; v0.1 permits everything, the seam exists.
    const trip = await tripRepo.get(db, tripId);
    const owner = await userRepo.get(db, trip.createdBy);
    const limits = resolveLimits((owner?.plan ?? 'unlimited') as 'unlimited');
    const usage = await attachmentRepo.usage(db, tripId);
    const perTrip = check(limits, 'receipts.perTrip', usage.count + 1n);
    if (!perTrip.ok) throw new HTTPException(402, { message: `receipt limit reached (${String(perTrip.limit)})` });
    const byBytes = check(limits, 'receipts.bytesPerTrip', usage.bytes + BigInt(body.bytes));
    if (!byBytes.ok) throw new HTTPException(402, { message: 'receipt storage limit reached' });

    const blobKey = key(tripId, body.id);
    // bytes = 0 marks the row unconfirmed until the client reports success.
    await attachmentRepo.create(db, { id: body.id, tripId, entryId, blobKey, bytes: 0n, mime: body.mime });
    const upload = await blobs.presignUpload(blobKey, body.mime, Math.min(body.bytes, RECEIPT_MAX_BYTES), UPLOAD_TTL);
    return jsonBig(c, { id: body.id, upload, expiresIn: UPLOAD_TTL }, 201);
  });

  /** Step 2: the client confirms the byte count it actually uploaded. */
  app.post('/trips/:tripId/attachments/:aid/confirm', zValidator('json', createAttachment.pick({ bytes: true })), async (c) => {
    const tripId = c.get('tripId');
    const a = await attachmentRepo.get(db, tripId, c.req.param('aid'));
    const row = await attachmentRepo.confirm(db, tripId, a.id, BigInt(c.req.valid('json').bytes));
    return jsonBig(c, row);
  });

  app.get('/trips/:tripId/entries/:eid/attachments', async (c) => {
    const tripId = c.get('tripId');
    const rows = await attachmentRepo.listByEntry(db, tripId, c.req.param('eid'));
    const withUrls = await Promise.all(rows.map(async (r) => ({ id: r.id, mime: r.mime, bytes: r.bytes, uploadedAt: r.uploadedAt.toISOString(), url: await blobs.presignDownload(r.blobKey, DOWNLOAD_TTL) })));
    return jsonBig(c, { attachments: withUrls, expiresIn: DOWNLOAD_TTL });
  });

  app.delete('/trips/:tripId/attachments/:aid', async (c) => {
    const tripId = c.get('tripId');
    const a = await attachmentRepo.softDelete(db, tripId, c.req.param('aid'));
    await blobs.delete(a.blobKey);
    return c.body(null, 204);
  });

  /** Effective retention for this trip, so the UI can say when receipts disappear (D11). */
  app.get('/trips/:tripId/attachments/retention', async (c) => {
    const trip = await tripRepo.get(db, c.get('tripId'));
    const owner = await userRepo.get(db, trip.createdBy);
    const limits = resolveLimits((owner?.plan ?? 'unlimited') as 'unlimited');
    const days = effectiveRetentionDays(limits, BigInt(trip.retentionDays));
    return jsonBig(c, { retentionDays: Number(days), usage: await attachmentRepo.usage(db, c.get('tripId')) });
  });

  /**
   * Dev/local only: the LocalBlobStore serves its own signed URLs from here, so the whole
   * upload flow works without object storage. Never mounted for an S3-backed store.
   */
  if (blobs instanceof LocalBlobStore) {
    const local = blobs;
    app.put('/blobs/:key', async (c) => {
      const k = decodeURIComponent(c.req.param('key'));
      const { exp = '', sig = '', max = '0' } = c.req.query();
      const mime = c.req.header('content-type') ?? '';
      if (!local.verify('put', k, exp, sig, `${mime}:${max}`)) throw new HTTPException(403, { message: 'bad signature' });
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (body.byteLength > Number(max)) throw new HTTPException(413, { message: 'too large' });
      local.put(k, mime, body);
      return c.body(null, 204);
    });
    app.get('/blobs/:key', (c) => {
      const k = decodeURIComponent(c.req.param('key'));
      const { exp = '', sig = '' } = c.req.query();
      if (!local.verify('get', k, exp, sig)) throw new HTTPException(403, { message: 'bad signature' });
      const blob = local.get(k);
      if (!blob) throw new HTTPException(404, { message: 'not found' });
      return c.body(blob.body as unknown as ArrayBuffer, 200, { 'content-type': blob.mime, 'cache-control': 'private, max-age=300' });
    });
  }

  return app;
}
