/**
 * IdentityVerifier port (architecture.md §6.2): verify a provider token, get a
 * stable subject. Apple and Google both issue OIDC ID tokens signed with keys
 * published as JWKS; verification is signature + iss + aud + exp. No SDK (A2).
 */
import { type JWTPayload, type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from 'jose';

export type Provider = 'apple' | 'google';

export interface VerifiedIdentity {
  readonly provider: Provider;
  readonly subject: string;
  /** Only when the provider asserts it as verified. */
  readonly email?: string;
}

export interface IdentityVerifier {
  verify(provider: Provider, token: string): Promise<VerifiedIdentity>;
}

export class IdentityError extends Error {
  constructor(readonly code: 'INVALID_TOKEN' | 'WRONG_AUDIENCE' | 'UNSUPPORTED_PROVIDER', message: string) {
    super(message); this.name = 'IdentityError';
  }
}

export interface OidcProviderConfig {
  readonly issuer: string | readonly string[];
  /** Accepted `aud` values: the iOS bundle id / services id for Apple, the OAuth client ids for Google. */
  readonly audiences: readonly string[];
  readonly keys: JWTVerifyGetKey;
}

export const APPLE_ISSUER = 'https://appleid.apple.com';
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;

export function defaultProviderConfigs(env: { appleAudiences: readonly string[]; googleAudiences: readonly string[] }): Record<Provider, OidcProviderConfig> {
  return {
    apple: { issuer: APPLE_ISSUER, audiences: env.appleAudiences, keys: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')) },
    google: { issuer: GOOGLE_ISSUERS, audiences: env.googleAudiences, keys: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')) },
  };
}

export class OidcVerifier implements IdentityVerifier {
  /** `now` makes `exp`/`iat` checks deterministic (tests) and consistent with the rest of the app (Clock port). */
  constructor(private readonly providers: Partial<Record<Provider, OidcProviderConfig>>, private readonly now: () => number = Date.now) {}

  async verify(provider: Provider, token: string): Promise<VerifiedIdentity> {
    const cfg = this.providers[provider];
    if (!cfg) throw new IdentityError('UNSUPPORTED_PROVIDER', `${provider} sign-in is not configured`);
    let payload: JWTPayload;
    try {
      const issuer: string[] = typeof cfg.issuer === 'string' ? [cfg.issuer] : [...cfg.issuer];
      ({ payload } = await jwtVerify(token, cfg.keys, { issuer, currentDate: new Date(this.now()), clockTolerance: 60 }));
    } catch (e) {
      throw new IdentityError('INVALID_TOKEN', `${provider} token rejected: ${e instanceof Error ? e.message : String(e)}`);
    }
    const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (!aud.some((a) => cfg.audiences.includes(a))) throw new IdentityError('WRONG_AUDIENCE', `${provider} token audience not accepted`);
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new IdentityError('INVALID_TOKEN', 'token has no subject');
    const claims = payload as { email?: unknown; email_verified?: unknown };
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : undefined;
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    return { provider, subject: payload.sub, ...(email && verified ? { email } : {}) };
  }
}
