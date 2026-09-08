/**
 * Pure state transitions for the sync layer (architecture.md §6.3, A7).
 * No I/O here: the engine calls these, the store applies the results, and the
 * tests exercise them directly.
 */
import { type WireEntry } from '@vst/domain';
import { type Feed } from '../api/types';

export interface Participant { readonly id: string; readonly name: string; readonly userId?: string | null; readonly tombstoned?: boolean }
export interface TripMeta { readonly id: string; readonly name: string; readonly ccy: string; readonly timezone: string; readonly status: 'open' | 'settling' | 'closed'; readonly remote: boolean }

export type OutboxOp =
  | { readonly opId: string; readonly kind: 'create'; readonly entry: WireEntry }
  | { readonly opId: string; readonly kind: 'update'; readonly entry: WireEntry }
  | { readonly opId: string; readonly kind: 'delete' | 'restore'; readonly entryId: string }
  | { readonly opId: string; readonly kind: 'settleShare'; readonly entryId: string; readonly participantId: string; readonly transferEntryId: string | null }
  | { readonly opId: string; readonly kind: 'addParticipant'; readonly participant: { id: string; displayName: string; joinedAt: string } };

export interface TripState {
  readonly meta: TripMeta;
  readonly participants: Participant[];
  readonly entries: WireEntry[];
  readonly meId: string | null;
  /** Change-feed cursor (bigint as string). */
  readonly seq: string;
  /** Server version per entry, for If-Match. */
  readonly versions: Record<string, number>;
  readonly outbox: OutboxOp[];
  /** Our discarded version after a lost write (FR-9.5 conflict notice). */
  readonly conflicts: Record<string, WireEntry>;
  readonly lastSyncAt: number | null;
  readonly syncError: string | null;
}

export function emptyTrip(meta: TripMeta): TripState {
  return { meta, participants: [], entries: [], meId: null, seq: '0', versions: {}, outbox: [], conflicts: {}, lastSyncAt: null, syncError: null };
}

const entryOf = (op: OutboxOp): string | null => op.kind === 'create' || op.kind === 'update' ? op.entry.id : op.kind === 'addParticipant' ? null : op.entryId;

/**
 * Add an op, folding it into a pending op on the same entry so the server sees
 * one write per entry: edit-after-create stays a create, delete-after-create
 * cancels both, edit-after-edit keeps the last edit.
 */
export function enqueue(outbox: readonly OutboxOp[], op: OutboxOp): OutboxOp[] {
  const id = entryOf(op);
  if (id === null || op.kind === 'settleShare') return [...outbox, op];
  const idx = outbox.findIndex((o) => entryOf(o) === id && o.kind !== 'settleShare');
  if (idx < 0) return [...outbox, op];
  const prev = outbox[idx] as OutboxOp;
  const rest = outbox.filter((_, i) => i !== idx);
  if (prev.kind === 'create') {
    if (op.kind === 'update') return [...rest, { ...prev, entry: op.entry }];
    if (op.kind === 'delete') return rest; // never reached the server: forget it
    return [...rest, prev];
  }
  if (prev.kind === 'update' && op.kind === 'update') return [...rest, op];
  if ((prev.kind === 'delete' && op.kind === 'restore') || (prev.kind === 'restore' && op.kind === 'delete')) return rest;
  return [...rest, op];
}

export const hasPending = (state: TripState, entryId: string): boolean => state.outbox.some((o) => entryOf(o) === entryId);

/** Merge a change-feed page. Entries with a pending local write keep the local version until it is pushed. */
export function applyFeed(state: TripState, feed: Feed): TripState {
  const entries = new Map(state.entries.map((e) => [e.id, e]));
  const versions = { ...state.versions };
  for (const rec of feed.entries) {
    const { version, seq: _s, ...wire } = rec;
    versions[rec.id] = version;
    if (hasPending(state, rec.id)) continue;
    entries.set(rec.id, wire);
  }
  const participants = new Map(state.participants.map((p) => [p.id, p]));
  for (const p of feed.participants) participants.set(p.id, { id: p.id, name: p.displayName, userId: p.userId, tombstoned: p.tombstonedAt !== null });
  const meta = feed.trip ? { ...state.meta, name: feed.trip.name, ccy: feed.trip.baseCcy, timezone: feed.trip.timezone, status: feed.trip.status } : state.meta;
  const cmp = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);
  const seq = cmp(feed.seq, state.seq) > 0 ? feed.seq : state.seq;
  return { ...state, meta, entries: [...entries.values()], participants: [...participants.values()], versions, seq };
}

/** The server accepted an op: record the version it returned. */
export function ack(state: TripState, opId: string, result?: { id: string; version: number } & Partial<WireEntry>): TripState {
  const outbox = state.outbox.filter((o) => o.opId !== opId);
  if (!result) return { ...state, outbox };
  const versions = { ...state.versions, [result.id]: result.version };
  // Only replace the local copy with the server's if nothing newer is pending for it.
  const stillPending = outbox.some((o) => entryOf(o) === result.id && o.kind !== 'settleShare');
  const entries = stillPending || !('type' in result) ? state.entries : state.entries.map((e) => (e.id === result.id ? stripRecord(result as WireEntry & { version: number }) : e));
  return { ...state, outbox, versions, entries };
}

/** Our write lost (409): the server's row wins, ours is kept as a notice. */
export function conflict(state: TripState, opId: string, current: WireEntry & { version: number }): TripState {
  const op = state.outbox.find((o) => o.opId === opId);
  const mine = op && (op.kind === 'create' || op.kind === 'update') ? op.entry : state.entries.find((e) => e.id === current.id);
  const outbox = state.outbox.filter((o) => o.opId !== opId && entryOf(o) !== current.id);
  const wire = stripRecord(current);
  return {
    ...state, outbox,
    versions: { ...state.versions, [current.id]: current.version },
    entries: state.entries.some((e) => e.id === current.id) ? state.entries.map((e) => (e.id === current.id ? wire : e)) : [...state.entries, wire],
    conflicts: mine ? { ...state.conflicts, [current.id]: mine } : state.conflicts,
  };
}

/** Drop an op the server rejected for good (4xx other than 409); keep local state, surface the error. */
export function reject(state: TripState, opId: string, message: string): TripState {
  return { ...state, outbox: state.outbox.filter((o) => o.opId !== opId), syncError: message };
}

function stripRecord(rec: WireEntry & { version?: number; seq?: string; tripId?: string; updatedAt?: string }): WireEntry {
  const { version: _v, seq: _s, tripId: _t, updatedAt: _u, ...wire } = rec;
  return wire;
}
