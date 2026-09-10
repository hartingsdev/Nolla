/**
 * Local-first store (architecture.md §7). Every trip is a TripState (sync/merge.ts):
 * the ledger in WIRE form plus an outbox of pending writes. The 'local' trip never
 * syncs and needs no account; remote trips push their outbox and pull the change
 * feed through the sync engine. Screens only ever see the ACTIVE trip.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { type TripStatus, type WireEntry } from '@vst/domain';
import { DEFAULT_API_URL } from './api/client';
import { uuidv7 } from './ids';
import { sampleTrip } from './sample';
import { type Feed } from './api/types';
import { type OutboxOp, type Participant, type TripMeta, type TripState, ack, applyFeed, conflict, emptyTrip, enqueue, reject } from './sync/merge';

export type { Participant, TripMeta, TripState } from './sync/merge';

export interface Auth { readonly token: string; readonly userId: string; readonly email: string | null }

export interface State {
  trips: Record<string, TripState>;
  /**
   * `null` means no trip is open — the state after deleting the one you were in.
   * Trip-scoped screens redirect to the trip list rather than every selector
   * learning to cope with a missing trip (#12).
   */
  activeTripId: string | null;
  auth: Auth | null;
  apiUrl: string;
  pendingInvite: string | null;
  locale: 'en' | 'de' | null;
  hydrated: boolean;
}
interface Actions {
  readonly setHydrated: () => void;
  readonly setLocale: (l: 'en' | 'de') => void;
  readonly setAuth: (a: Auth | null) => void;
  readonly setApiUrl: (url: string) => void;
  readonly setPendingInvite: (token: string | null) => void;
  readonly setActiveTrip: (id: string) => void;
  readonly upsertTrip: (t: TripState) => void;
  readonly removeTrip: (id: string) => void;
  /** Entry actions apply to the ACTIVE trip and, for remote trips, enqueue the write. */
  readonly addEntry: (e: WireEntry) => void;
  readonly updateEntry: (e: WireEntry) => void;
  readonly deleteEntry: (id: string) => void;
  readonly restoreEntry: (id: string) => void;
  readonly markShareSettled: (entryId: string, participantId: string, transferIds: readonly string[]) => void;
  /** FR-5.3: the recipient flags a payment they do not recognise, or takes it back. */
  readonly setDispute: (entryId: string, dispute: { reason?: string } | null) => void;
  readonly addParticipant: (p: Participant, joinedAt: string) => void;
  readonly removeParticipant: (id: string) => void;
  /** FR-1.12: correct a participant's name — your own, or anyone's if you are an admin. */
  readonly renameParticipant: (id: string, displayName: string) => void;
  readonly setMe: (id: string | null) => void;
  readonly setStatus: (status: TripStatus) => void;
  readonly setTripMeta: (patch: Partial<Pick<TripMeta, 'name' | 'ccy'>>) => void;
  /** Adds a local trip and opens it. Returns its id. */
  readonly createLocalTrip: (name: string) => string;
  readonly loadSample: () => void;
  readonly clearAll: () => void;
  /** Sync engine hooks (SyncStore). */
  readonly getTrip: (id: string) => TripState | undefined;
  readonly setTrip: (id: string, update: (s: TripState) => TripState) => void;
  readonly dismissConflict: (entryId: string) => void;
}

/**
 * The id of the local trip that existed before trips could be plural. New local
 * trips get generated ids; this one is kept so installs that predate #12 do not
 * lose theirs. It is no longer special in any other way.
 */
export const LOCAL_TRIP_ID = 'local';
const localMeta: TripMeta = { id: LOCAL_TRIP_ID, name: 'My trip', ccy: 'EUR', timezone: 'Europe/Berlin', status: 'open', remote: false };
const newLocalMeta = (id: string, name: string): TripMeta => ({ ...localMeta, id, name });
const opId = () => `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => {
      const active = () => { const id = get().activeTripId; return id === null ? undefined : get().trips[id]; };
      /** Apply a local change to the active trip; for remote trips also queue it. */
      const change = (local: (t: TripState) => TripState, op?: (t: TripState) => OutboxOp) => set((s) => {
        const id = s.activeTripId;
        const t = id === null ? undefined : s.trips[id];
        if (!t || id === null) return s;
        let next = local(t);
        if (t.meta.remote && op) next = { ...next, outbox: enqueue(next.outbox, op(next)) };
        return { trips: { ...s.trips, [id]: next } };
      });
      return {
        trips: { [LOCAL_TRIP_ID]: emptyTrip(localMeta) },
        activeTripId: LOCAL_TRIP_ID,
        auth: null,
        apiUrl: DEFAULT_API_URL,
        pendingInvite: null,
        locale: null,
        hydrated: false,
        setHydrated: () => set({ hydrated: true }),
        setLocale: (locale) => set({ locale }),
        setAuth: (auth) => set({ auth }),
        setApiUrl: (apiUrl) => set({ apiUrl }),
        setPendingInvite: (pendingInvite) => set({ pendingInvite }),
        setActiveTrip: (activeTripId) => set((s) => (s.trips[activeTripId] ? { activeTripId } : s)),
        upsertTrip: (t) => set((s) => ({ trips: { ...s.trips, [t.meta.id]: { ...(s.trips[t.meta.id] ?? {}), ...t } } })),
        removeTrip: (id) => set((s) => ({ trips: Object.fromEntries(Object.entries(s.trips).filter(([k]) => k !== id)), activeTripId: s.activeTripId === id ? null : s.activeTripId })),

        addEntry: (e) => { change((t) => ({ ...t, entries: [...t.entries, e] }), () => ({ opId: opId(), kind: 'create', entry: e })); },
        updateEntry: (e) => { change((t) => ({ ...t, entries: t.entries.map((x) => (x.id === e.id ? e : x)) }), () => ({ opId: opId(), kind: 'update', entry: e })); },
        deleteEntry: (id) => { change((t) => ({ ...t, entries: t.entries.map((x) => (x.id === id ? { ...x, deleted: true } : x)) }), () => ({ opId: opId(), kind: 'delete', entryId: id })); },
        restoreEntry: (id) => { change((t) => ({ ...t, entries: t.entries.map((x) => (x.id === id ? { ...x, deleted: false } : x)) }), () => ({ opId: opId(), kind: 'restore', entryId: id })); },
        markShareSettled: (entryId, participantId, transferIds) => {
          change(
            (t) => ({ ...t, entries: t.entries.map((x) => (x.id === entryId ? { ...x, shares: x.shares.map((sh) => (sh.participantId === participantId ? { ...sh, settledBy: transferIds.join(',') } : sh)) } : x)) }),
            () => ({ opId: opId(), kind: 'settleShare', entryId, participantId, transferEntryId: transferIds[0] ?? null }),
          );
        },
        setDispute: (entryId, dispute) => {
          const by = active()?.meId ?? '';
          const at = new Date().toISOString();
          change(
            (t) => ({
              ...t,
              entries: t.entries.map((e) => {
                if (e.id !== entryId) return e;
                if (!dispute) { const { dispute: _gone, ...rest } = e; return rest; }
                return { ...e, dispute: { at, by, ...(dispute.reason !== undefined ? { reason: dispute.reason } : {}) } };
              }),
            }),
            () => ({ opId: opId(), kind: 'dispute', entryId, disputed: dispute !== null, ...(dispute?.reason !== undefined ? { reason: dispute.reason } : {}) }),
          );
        },
        addParticipant: (p, joinedAt) => { change((t) => ({ ...t, participants: [...t.participants, p] }), () => ({ opId: opId(), kind: 'addParticipant', participant: { id: p.id, displayName: p.name, joinedAt } })); },
        renameParticipant: (id, displayName) => {
          const name = displayName.trim();
          if (!name) return;
          change(
            (t) => ({ ...t, participants: t.participants.map((p) => (p.id === id ? { ...p, name } : p)) }),
            () => ({ opId: opId(), kind: 'renameParticipant', participantId: id, displayName: name }),
          );
        },
        removeParticipant: (id) => { change((t) => ({ ...t, participants: t.participants.filter((p) => p.id !== id), meId: t.meId === id ? null : t.meId })); },
        setMe: (meId) => { change((t) => ({ ...t, meId })); },
        setStatus: (status) => { change((t) => ({ ...t, meta: { ...t.meta, status } })); },
        setTripMeta: (patch) => { change((t) => ({ ...t, meta: { ...t.meta, ...patch } })); },
        createLocalTrip: (name) => {
          const id = uuidv7();
          set((s) => ({ trips: { ...s.trips, [id]: emptyTrip(newLocalMeta(id, name)) }, activeTripId: id }));
          return id;
        },
        /** Developer affordance: a fresh local trip carrying the worked example. */
        loadSample: () => set((s) => {
          const sample = sampleTrip();
          const id = uuidv7();
          const t: TripState = { ...emptyTrip({ ...newLocalMeta(id, sample.trip.name), ccy: sample.trip.ccy }), participants: sample.participants, entries: sample.entries };
          return { trips: { ...s.trips, [id]: t }, activeTripId: id };
        }),
        /** Developer affordance: wipe the device. No trip is open afterwards. */
        clearAll: () => set(() => ({ trips: {}, activeTripId: null })),

        getTrip: (id) => get().trips[id],
        setTrip: (id, update) => set((s) => { const t = s.trips[id]; return t ? { trips: { ...s.trips, [id]: update(t) } } : s; }),
        dismissConflict: (entryId) => { const t = active(); if (!t) return; get().setTrip(t.meta.id, (s) => ({ ...s, conflicts: Object.fromEntries(Object.entries(s.conflicts).filter(([k]) => k !== entryId)) })); },
      };
    },
    {
      // Deliberately not renamed with the app (Nolla): this key addresses data
      // already on people's devices, and changing it would orphan their trips.
      name: 'trip-ledger:v1',
      version: 3,
      migrate: (persisted, version) => {
        const p = persisted as Record<string, unknown>;
        if (version < 3) {
          // v2 held one trip at the top level; wrap it as the local trip.
          const old = p as { trip?: { name?: string; ccy?: string; status?: TripStatus }; participants?: Participant[]; entries?: WireEntry[]; meId?: string | null; locale?: 'en' | 'de' | null };
          const meta: TripMeta = { ...localMeta, name: old.trip?.name ?? localMeta.name, ccy: old.trip?.ccy ?? 'EUR', status: old.trip?.status ?? 'open' };
          const t: TripState = { ...emptyTrip(meta), participants: old.participants ?? [], entries: old.entries ?? [], meId: old.meId ?? null };
          return { trips: { [LOCAL_TRIP_ID]: t }, activeTripId: LOCAL_TRIP_ID, auth: null, apiUrl: DEFAULT_API_URL, pendingInvite: null, locale: old.locale ?? null };
        }
        return p;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ trips: s.trips, activeTripId: s.activeTripId, auth: s.auth, apiUrl: s.apiUrl, pendingInvite: s.pendingInvite, locale: s.locale }),
      onRehydrateStorage: () => (state) => { state?.setHydrated(); },
    },
  ),
);

/** Re-exported for the engine adapter. */
export const mergeFns = { ack, applyFeed, conflict, reject };
export type { Feed };
