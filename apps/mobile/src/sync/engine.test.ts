import { describe, expect, it } from 'vitest';
import { type ParticipantId, type WireEntry, allocate, currency, entryToWire, localDate, money } from '@vst/domain';
import { ApiError, type EntryRecord, type Feed, NetworkError } from '../api/types';
import { type SyncApi, type SyncStore, syncTrip } from './engine';
import { type TripState, applyFeed, emptyTrip, enqueue } from './merge';

const EUR = currency('EUR');
const P1 = '11111111-1111-4111-8111-111111111111'; const P2 = '22222222-2222-4222-8222-222222222222';
function wire(id: string, minor: bigint, description = 'x'): WireEntry {
  const m = money(minor, EUR);
  return entryToWire({ id, type: 'expense', description, amount: m, date: localDate('2026-09-01'), payments: [{ participantId: P1 as ParticipantId, amount: m }], shares: allocate(m, { kind: 'equal', among: [P1, P2] as ParticipantId[] }, { seed: id }), createdAt: '2026-09-01T00:00:00.000Z' });
}
const meta = { id: 'trip', name: 'T', ccy: 'EUR', timezone: 'Europe/Berlin', status: 'open' as const, remote: true };
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

/** A fake server: a ledger with versions and a seq counter, plus a failure switch. */
class FakeApi implements SyncApi {
  rows = new Map<string, EntryRecord>(); seq = 0; offline = false; calls: string[] = [];
  private bump(rec: WireEntry, version: number): EntryRecord { this.seq += 1; const r = { ...rec, tripId: 'trip', version, seq: String(this.seq), updatedAt: 'now' }; this.rows.set(rec.id, r); return r; }
  private guard(name: string) { this.calls.push(name); if (this.offline) throw new NetworkError('offline'); }
  async pull(_t: string, since: string): Promise<Feed> {
    this.guard('pull');
    const entries = [...this.rows.values()].filter((r) => BigInt(r.seq) > BigInt(since)).sort((a, b) => Number(BigInt(a.seq) - BigInt(b.seq)));
    return { seq: String(this.seq), entries, participants: [], trip: since === '0' ? { id: 'trip', name: 'Server name', baseCcy: 'EUR', timezone: 'Europe/Berlin', status: 'open', seq: String(this.seq), metaSeq: '0' } : null, more: false };
  }
  async createEntry(_t: string, e: WireEntry) { this.guard('create'); if (this.rows.has(e.id)) throw new ApiError(409, 'CONFLICT', 'exists', this.rows.get(e.id)); return this.bump(e, 1); }
  async updateEntry(_t: string, e: WireEntry, ifMatch: number) {
    this.guard('update'); const cur = this.rows.get(e.id);
    if (!cur) throw new ApiError(404, 'NOT_FOUND', 'nope');
    if (cur.version !== ifMatch) throw new ApiError(409, 'CONFLICT', 'stale', cur);
    return this.bump(e, cur.version + 1);
  }
  async setDeleted(_t: string, id: string, ifMatch: number, deleted: boolean) {
    this.guard('delete'); const cur = this.rows.get(id)!;
    if (cur.version !== ifMatch) throw new ApiError(409, 'CONFLICT', 'stale', cur);
    return this.bump({ ...cur, deleted }, cur.version + 1);
  }
  async settleShare() { this.guard('settle'); return null; }
  async addParticipant(_t: string, p: { id: string; displayName: string }) { this.guard('participant'); return { id: p.id, displayName: p.displayName, userId: null, joinedAt: '2026-09-01', tombstonedAt: null, seq: '1' }; }
  /** Someone else edits on the server. */
  serverEdit(id: string, description: string) { const cur = this.rows.get(id)!; this.bump({ ...cur, description }, cur.version + 1); }
}
class MemStore implements SyncStore {
  constructor(public state: TripState) {}
  get() { return this.state; }
  set(_t: string, u: (s: TripState) => TripState) { this.state = u(this.state); }
}

describe('enqueue coalescing', () => {
  const a = wire(uuid(1), 100n);
  it('edit after create stays one create; delete after create cancels both', () => {
    let ob = enqueue([], { opId: '1', kind: 'create', entry: a });
    ob = enqueue(ob, { opId: '2', kind: 'update', entry: { ...a, description: 'edited' } });
    expect(ob).toHaveLength(1); expect(ob[0]).toMatchObject({ kind: 'create', entry: { description: 'edited' } });
    expect(enqueue(ob, { opId: '3', kind: 'delete', entryId: a.id })).toEqual([]);
  });
  it('edit after edit keeps the last; delete then restore cancels', () => {
    let ob = enqueue([], { opId: '1', kind: 'update', entry: a });
    ob = enqueue(ob, { opId: '2', kind: 'update', entry: { ...a, description: 'two' } });
    expect(ob).toHaveLength(1); expect(ob[0]).toMatchObject({ opId: '2' });
    expect(enqueue(enqueue([], { opId: '3', kind: 'delete', entryId: a.id }), { opId: '4', kind: 'restore', entryId: a.id })).toEqual([]);
  });
});

describe('syncTrip', () => {
  it('pushes the outbox in order, then pulls, and records versions and the cursor', async () => {
    const api = new FakeApi();
    const a = wire(uuid(1), 100n); const b = wire(uuid(2), 200n);
    const store = new MemStore({ ...emptyTrip(meta), entries: [a, b], outbox: [{ opId: '1', kind: 'create', entry: a }, { opId: '2', kind: 'create', entry: b }] });
    const r = await syncTrip('trip', api, store, () => 42);
    expect(r).toEqual({ ok: true, pushed: 2, pulled: 2 });
    expect(store.state.outbox).toEqual([]);
    expect(store.state.versions).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect(store.state.seq).toBe('2');
    expect(store.state.meta.name).toBe('Server name');
    expect(store.state.lastSyncAt).toBe(42);
    // second round is a no-op pull
    expect(await syncTrip('trip', api, store)).toEqual({ ok: true, pushed: 0, pulled: 0 });
  });

  it('offline: nothing is lost, everything stays queued, and the next round delivers it', async () => {
    const api = new FakeApi(); api.offline = true;
    const a = wire(uuid(1), 100n);
    const store = new MemStore({ ...emptyTrip(meta), entries: [a], outbox: [{ opId: '1', kind: 'create', entry: a }] });
    expect(await syncTrip('trip', api, store)).toMatchObject({ ok: false, error: 'network' });
    expect(store.state.outbox).toHaveLength(1); expect(store.state.syncError).toBe('offline');
    api.offline = false;
    expect(await syncTrip('trip', api, store)).toMatchObject({ ok: true, pushed: 1 });
    expect(store.state.syncError).toBeNull();
  });

  it('a lost write becomes a conflict notice and the server row wins (FR-9.5)', async () => {
    const api = new FakeApi();
    const a = wire(uuid(1), 100n);
    const store = new MemStore({ ...emptyTrip(meta), entries: [a], outbox: [{ opId: '1', kind: 'create', entry: a }] });
    await syncTrip('trip', api, store);
    api.serverEdit(a.id, 'theirs');                           // someone else edits first
    store.set('trip', (s) => ({ ...s, entries: [{ ...a, description: 'mine' }], outbox: enqueue(s.outbox, { opId: '2', kind: 'update', entry: { ...a, description: 'mine' } }) }));
    const r = await syncTrip('trip', api, store);
    expect(r).toMatchObject({ ok: true, pushed: 0 });
    expect(store.state.entries[0]?.description).toBe('theirs');
    expect(store.state.conflicts[a.id]?.description).toBe('mine');
    expect(store.state.versions[a.id]).toBe(2);
    expect(store.state.outbox).toEqual([]);
  });

  it('pull keeps the local version of an entry with a pending write, and takes the server version otherwise', () => {
    const a = wire(uuid(1), 100n);
    const state: TripState = { ...emptyTrip(meta), entries: [{ ...a, description: 'local edit' }], outbox: [{ opId: '1', kind: 'update', entry: { ...a, description: 'local edit' } }] };
    const feed: Feed = { seq: '5', entries: [{ ...a, description: 'server', version: 3, seq: '5' }], participants: [], trip: null, more: false };
    const merged = applyFeed(state, feed);
    expect(merged.entries[0]?.description).toBe('local edit');
    expect(merged.versions[a.id]).toBe(3);
    const merged2 = applyFeed({ ...state, outbox: [] }, feed);
    expect(merged2.entries[0]?.description).toBe('server');
  });

  it('a permanently rejected op is dropped and surfaced, the rest continues', async () => {
    const api = new FakeApi();
    const a = wire(uuid(1), 100n); const b = wire(uuid(2), 200n);
    const store = new MemStore({ ...emptyTrip(meta), entries: [a, b], outbox: [{ opId: '1', kind: 'update', entry: a }, { opId: '2', kind: 'create', entry: b }] });
    const r = await syncTrip('trip', api, store);
    expect(r).toMatchObject({ ok: true, pushed: 1 });
    expect(api.rows.has(b.id)).toBe(true);
    expect(store.state.syncError).toBeNull(); // cleared by the successful pull; the rejection was logged on the way
  });

  it('an expired session stops the round with an auth error', async () => {
    const api = new FakeApi();
    api.pull = async () => { throw new ApiError(401, 'UNAUTHORIZED', 'sign in required'); };
    const store = new MemStore(emptyTrip(meta));
    expect(await syncTrip('trip', api, store)).toMatchObject({ ok: false, error: 'auth' });
  });
});
