import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiClient } from '../api/client';
import { useStore } from '../store';
import { type SyncOutcome, syncTrip } from './engine';

export const POLL_MS = 10_000;

/** Lets any screen ask the app-level sync loop for a round now (the "Sync now" button). */
let requester: (() => Promise<SyncOutcome | null>) | null = null;
const syncingListeners = new Set<(v: boolean) => void>();
export function requestSync(): Promise<SyncOutcome | null> { return requester ? requester() : Promise.resolve(null); }
export function useSyncing(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => { syncingListeners.add(setV); return () => { syncingListeners.delete(setV); }; }, []);
  return v;
}

export function useApi(): ApiClient {
  const apiUrl = useStore((s) => s.apiUrl);
  const token = useStore((s) => s.auth?.token ?? null);
  return useMemo(() => new ApiClient(apiUrl, token), [apiUrl, token]);
}

/**
 * Keep the active trip in sync while the app is open (architecture.md §6.3): on mount, every
 * POLL_MS in the foreground, on app resume, and whenever the outbox grows. Mounted ONCE, in
 * the root layout, so writes from any screen are pushed.
 */
export function useSync(): { syncNow: () => Promise<SyncOutcome | null>; syncing: boolean } {
  const api = useApi();
  const tripId = useStore((s) => s.activeTripId);
  const remote = useStore((s) => s.trips[s.activeTripId]?.meta.remote ?? false);
  const outboxLen = useStore((s) => s.trips[s.activeTripId]?.outbox.length ?? 0);
  const authed = useStore((s) => s.auth !== null);
  const setAuth = useStore((s) => s.setAuth);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const syncNow = useCallback(async (): Promise<SyncOutcome | null> => {
    if (!remote || !authed || busy.current) return null;
    busy.current = true; setSyncing(true); for (const l of syncingListeners) l(true);
    try {
      const store = { get: useStore.getState().getTrip, set: useStore.getState().setTrip };
      const r = await syncTrip(tripId, api, store);
      if (!r.ok && r.error === 'auth') setAuth(null);
      return r;
    } finally { busy.current = false; setSyncing(false); for (const l of syncingListeners) l(false); }
  }, [api, tripId, remote, authed, setAuth]);

  useEffect(() => { requester = syncNow; return () => { if (requester === syncNow) requester = null; }; }, [syncNow]);
  useEffect(() => { void syncNow(); }, [syncNow, outboxLen]);
  useEffect(() => {
    if (!remote || !authed) return;
    const id = setInterval(() => { if (AppState.currentState === 'active') void syncNow(); }, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void syncNow(); });
    return () => { clearInterval(id); sub.remove(); };
  }, [syncNow, remote, authed]);

  return { syncNow, syncing };
}
