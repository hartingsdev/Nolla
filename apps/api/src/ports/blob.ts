import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * BlobStore port (architecture.md §6.5). Receipts never pass through the API
 * process in production: the client uploads and downloads straight to object
 * storage with short-lived presigned URLs. The local adapter below serves the
 * same contract from the API itself, for development and tests.
 */
export interface BlobStore {
  presignUpload(key: string, mime: string, maxBytes: number, ttlSeconds: number): Promise<{ url: string; method: 'PUT'; headers: Record<string, string> }>;
  presignDownload(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

/** Signed URLs on the API's own /blobs routes; bytes kept in memory (tests) or handed to a writer (dev). */
export class LocalBlobStore implements BlobStore {
  private readonly bytes = new Map<string, { mime: string; body: Uint8Array }>();
  constructor(private readonly baseUrl: string, private readonly secret: string, private readonly now: () => number = Date.now) {}

  private sign(op: 'put' | 'get', key: string, exp: number, extra = ''): string {
    return createHmac('sha256', this.secret).update(`${op}\n${key}\n${String(exp)}\n${extra}`).digest('base64url');
  }
  verify(op: 'put' | 'get', key: string, exp: string, sig: string, extra = ''): boolean {
    const e = Number(exp);
    if (!Number.isFinite(e) || e * 1000 < this.now()) return false;
    const expected = Buffer.from(this.sign(op, key, e, extra));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
  presignUpload(key: string, mime: string, maxBytes: number, ttlSeconds: number) {
    const exp = Math.floor(this.now() / 1000) + ttlSeconds;
    const extra = `${mime}:${String(maxBytes)}`;
    const url = `${this.baseUrl}/blobs/${encodeURIComponent(key)}?op=put&exp=${String(exp)}&max=${String(maxBytes)}&sig=${this.sign('put', key, exp, extra)}`;
    return Promise.resolve({ url, method: 'PUT' as const, headers: { 'content-type': mime } });
  }
  presignDownload(key: string, ttlSeconds: number) {
    const exp = Math.floor(this.now() / 1000) + ttlSeconds;
    return Promise.resolve(`${this.baseUrl}/blobs/${encodeURIComponent(key)}?op=get&exp=${String(exp)}&sig=${this.sign('get', key, exp)}`);
  }
  delete(key: string) { this.bytes.delete(key); return Promise.resolve(); }
  put(key: string, mime: string, body: Uint8Array): void { this.bytes.set(key, { mime, body }); }
  get(key: string): { mime: string; body: Uint8Array } | undefined { return this.bytes.get(key); }
}
