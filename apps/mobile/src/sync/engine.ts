import { type WireEntry } from '@vst/domain';
import { ApiError, type EntryRecord, type Feed, NetworkError } from '../api/types';
import { type OutboxOp, type TripState, ack, applyFeed, conflict, reject, sameWireEntry } from './merge';

/** The slice of the API the engine needs; ApiClient satisfies it, tests fake it. */
export interface SyncApi {
  pull(tripId: string, since: string, limit?: number): Promise<Feed>;
  createEntry(tripId: string, entry: WireEntry): Promise<EntryRecord>;
  updateEntry(tripId: string, entry: WireEntry, ifMatch: number): Promise<EntryRecord>;
  setDeleted(tripId: string, id: string, ifMatch: number, deleted: boolean): Promise<EntryRecord>;
  settleShare(tripId: string, entryId: string, participantId: string, transferEntryId: string | null): Promise<null>;
  addParticipant(tripId: string, p: { id: string; displayName: string; joinedAt?: string }): Promise<Feed['participants'][number]>;
}

/** The engine reads and writes trip state through this, so the store stays the single owner. */
export interface SyncStore {
  get(tripId: string): TripState | undefined;
  set(tripId: string, update: (s: TripState) => TripState): void;
}

export const POLL_MS = 10_000;

/** Backoff after consecutive failures: 10s, 20s, 40s, 80s, capped at 5 min (architecture.md A5). */
export function backoffMs(failedRounds: number): number {
  return Math.min(POLL_MS * 2 ** Math.min(failedRounds, 5), 300_000);
}

export type SyncOutcome = { ok: true; pushed: number; pulled: number } | { ok: false; error: 'network' | 'auth' | 'other'; message: string };

/**
 * One sync round: push the outbox in order, then pull the feed to the end.
 * Stops on the first network failure (everything stays queued); drops ops the
 * server rejects; turns 409s into conflicts.
 *
 * A 5xx is the server's problem, not a rejection: the write stays queued and
 * the round backs off, because dropping it would lose a change the user has
 * already been shown. Only a 4xx means "this will never be accepted".
 */
export async function syncTrip(tripId: string, api: SyncApi, store: SyncStore, now: () => number = Date.now): Promise<SyncOutcome> {
  let pushed = 0;
  for (;;) {
    const state = store.get(tripId);
    const op = state?.outbox[0];
    if (!state || !op) break;
    try {
      const result = await pushOne(tripId, op, state, api);
      store.set(tripId, (s) => ack(s, op.opId, result));
      pushed += 1;
    } catch (e) {
      if (e instanceof NetworkError) return fail(store, tripId, 'network', e.message);
      if (e instanceof ApiError && e.status === 401) return fail(store, tripId, 'auth', e.message);
      if (e instanceof ApiError && e.status === 409 && e.current) {
        const current = e.current as WireEntry & { version: number };
        // Our own create, delivered twice: the server holds exactly what we sent,
        // so this is the missing acknowledgement, not somebody else's edit.
        if (op.kind === 'create' && sameWireEntry(op.entry, current)) {
          store.set(tripId, (s) => ack(s, op.opId, current));
          pushed += 1;
          continue;
        }
        store.set(tripId, (s) => conflict(s, op.opId, current));
        continue;
      }
      if (e instanceof ApiError && e.status >= 500) return fail(store, tripId, 'other', e.message);
      store.set(tripId, (s) => reject(s, op.opId, e instanceof Error ? e.message : String(e)));
    }
  }
  let pulled = 0;
  for (;;) {
    const state = store.get(tripId);
    if (!state) break;
    let feed: Feed;
    try { feed = await api.pull(tripId, state.seq); }
    catch (e) {
      if (e instanceof NetworkError) return fail(store, tripId, 'network', e.message);
      if (e instanceof ApiError && e.status === 401) return fail(store, tripId, 'auth', e.message);
      return fail(store, tripId, 'other', e instanceof Error ? e.message : String(e));
    }
    pulled += feed.entries.length;
    store.set(tripId, (s) => applyFeed(s, feed));
    if (!feed.more) break;
  }
  store.set(tripId, (s) => ({ ...s, lastSyncAt: now(), syncError: null, failedRounds: 0 }));
  return { ok: true, pushed, pulled };
}

async function pushOne(tripId: string, op: OutboxOp, state: TripState, api: SyncApi): Promise<({ id: string; version: number } & Partial<WireEntry>) | undefined> {
  const v = (id: string) => state.versions[id] ?? 1;
  switch (op.kind) {
    case 'create': return api.createEntry(tripId, op.entry);
    case 'update': return api.updateEntry(tripId, op.entry, v(op.entry.id));
    case 'delete': return api.setDeleted(tripId, op.entryId, v(op.entryId), true);
    case 'restore': return api.setDeleted(tripId, op.entryId, v(op.entryId), false);
    case 'settleShare': await api.settleShare(tripId, op.entryId, op.participantId, op.transferEntryId); return undefined;
    case 'addParticipant': await api.addParticipant(tripId, op.participant); return undefined;
  }
}

function fail(store: SyncStore, tripId: string, error: 'network' | 'auth' | 'other', message: string): SyncOutcome {
  store.set(tripId, (s) => ({ ...s, syncError: message, failedRounds: s.failedRounds + 1 }));
  return { ok: false, error, message };
}
