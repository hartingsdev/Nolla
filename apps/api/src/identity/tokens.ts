import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, base64url. The raw token is shown once and never stored (NFR-5). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
