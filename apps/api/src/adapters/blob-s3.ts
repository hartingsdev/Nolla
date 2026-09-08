import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type BlobStore } from '../ports/blob.ts';

/** Any S3-compatible bucket (AWS, R2, MinIO, Hetzner…). The only file that imports the SDK. */
export function s3BlobStore(opts: { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle?: boolean }): BlobStore {
  const client = new S3Client({
    region: opts.region, forcePathStyle: opts.forcePathStyle ?? !!opts.endpoint,
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
  });
  return {
    async presignUpload(key, mime, maxBytes, ttlSeconds) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: opts.bucket, Key: key, ContentType: mime, ContentLength: maxBytes }), { expiresIn: ttlSeconds });
      return { url, method: 'PUT', headers: { 'content-type': mime } };
    },
    presignDownload: (key, ttlSeconds) => getSignedUrl(client, new GetObjectCommand({ Bucket: opts.bucket, Key: key }), { expiresIn: ttlSeconds }),
    async delete(key) { await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key })); },
  };
}
