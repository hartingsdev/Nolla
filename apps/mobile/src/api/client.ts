import { type WireEntry } from '@vst/domain';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export { ApiError, NetworkError, type Feed, type EntryRecord } from './types';
import { ApiError, NetworkError, type Feed, type EntryRecord } from './types';

/** Thin typed fetch wrapper. Money is strings on the wire; nothing here parses amounts. */
export class ApiClient {
  constructor(readonly baseUrl: string, private readonly token: string | null) {}

  async request<T>(method: string, path: string, opts: { body?: unknown; ifMatch?: number } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'x-app-version': Constants.expoConfig?.version ?? 'dev',
      'x-platform': Platform.OS,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.ifMatch !== undefined) headers['if-match'] = String(opts.ifMatch);
    let res: Response;
    try {
      const init: RequestInit = { method, headers };
      if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : String(e));
    }
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string; current?: unknown } } | null)?.error;
      throw new ApiError(res.status, err?.code ?? 'HTTP', err?.message ?? res.statusText, err?.current);
    }
    return json as T;
  }

  // auth
  requestMagicLink(email: string) { return this.request<null>('POST', '/auth/email/request', { body: { email } }); }
  verifyMagicLink(token: string) { return this.request<{ token: string; userId: string; isNewUser: boolean }>('POST', '/auth/email/verify', { body: { token } }); }
  providerSignIn(provider: 'apple' | 'google', token: string) { return this.request<{ token: string; userId: string; isNewUser: boolean }>('POST', `/auth/${provider}`, { body: { token } }); }
  logout() { return this.request<null>('POST', '/auth/logout'); }
  me() { return this.request<{ id: string; email: string | null; displayName: string | null }>('GET', '/me'); }
  deleteAccount() { return this.request<null>('DELETE', '/me'); }
  // trips
  listTrips() { return this.request<{ trips: { id: string; name: string; baseCcy: string; timezone: string; status: 'open' | 'settling' | 'closed'; seq: string }[] }>('GET', '/trips'); }
  createTrip(body: { id: string; name: string; baseCcy: string; timezone?: string }) { return this.request<{ id: string }>('POST', '/trips', { body }); }
  getTrip(tripId: string) { return this.request<{ trip: Feed['trip']; participants: Feed['participants']; me: { userId: string; role: string } }>('GET', `/trips/${tripId}`); }
  patchTrip(tripId: string, patch: { name?: string }) { return this.request<unknown>('PATCH', `/trips/${tripId}`, { body: patch }); }
  transition(tripId: string, action: 'freeze' | 'reopen' | 'close') { return this.request<{ status: 'open' | 'settling' | 'closed' }>('POST', `/trips/${tripId}/transition`, { body: { action } }); }
  createInvite(tripId: string) { return this.request<{ url: string; expiresAt: string }>('POST', `/trips/${tripId}/invites`); }
  acceptInvite(token: string) { return this.request<{ tripId: string; participantId: string | null; unclaimed: { id: string; displayName: string }[] }>('POST', `/invites/${encodeURIComponent(token)}/accept`); }
  addParticipant(tripId: string, p: { id: string; displayName: string; joinedAt?: string }) { return this.request<Feed['participants'][number]>('POST', `/trips/${tripId}/participants`, { body: p }); }
  claimParticipant(tripId: string, pid: string) { return this.request<Feed['participants'][number]>('POST', `/trips/${tripId}/participants/${pid}/claim`); }
  // ledger
  pull(tripId: string, since: string, limit = 500) { return this.request<Feed>('GET', `/trips/${tripId}/entries?since=${since}&limit=${String(limit)}`); }
  createEntry(tripId: string, entry: WireEntry) { return this.request<EntryRecord>('POST', `/trips/${tripId}/entries`, { body: entry }); }
  updateEntry(tripId: string, entry: WireEntry, ifMatch: number) { return this.request<EntryRecord>('PATCH', `/trips/${tripId}/entries/${entry.id}`, { body: entry, ifMatch }); }
  setDeleted(tripId: string, id: string, ifMatch: number, deleted: boolean) { return this.request<EntryRecord>(deleted ? 'DELETE' : 'POST', `/trips/${tripId}/entries/${id}${deleted ? '' : '/restore'}`, { ifMatch }); }
  settleShare(tripId: string, entryId: string, participantId: string, transferEntryId: string | null) { return this.request<null>('POST', `/trips/${tripId}/entries/${entryId}/settle-share`, { body: { participantId, transferEntryId } }); }
  devMagicLinks() { return this.request<{ links: { to: string; url: string }[] }>('GET', '/dev/magic-links'); }
}

const apiUrlFromEnv = (process.env.EXPO_PUBLIC_API_URL ?? '').trim(); // CI may pass an empty string
export const DEFAULT_API_URL = apiUrlFromEnv === '' ? 'http://localhost:8080' : apiUrlFromEnv;
