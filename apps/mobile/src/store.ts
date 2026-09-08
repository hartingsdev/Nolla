/**
 * Local-first trip store. Holds the ledger in WIRE form (strings) so
 * persistence is plain JSON; selectors convert to domain types. This is the
 * seam the sync layer implements later (architecture.md §6.3): the actions
 * here become API calls + feed patches, the screens do not change.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { type WireEntry } from '@vst/domain';
import { sampleTrip } from './sample';

export interface Participant { readonly id: string; readonly name: string }
export interface TripMeta { readonly id: string; readonly name: string; readonly ccy: string; readonly timezone: string }

interface State {
  trip: TripMeta;
  participants: Participant[];
  entries: WireEntry[];
  meId: string | null;
  locale: 'en' | 'de' | null;
  hydrated: boolean;
}
interface Actions {
  readonly setHydrated: () => void;
  readonly addEntry: (e: WireEntry) => void;
  readonly updateEntry: (e: WireEntry) => void;
  readonly deleteEntry: (id: string) => void;
  readonly addParticipant: (p: Participant) => void;
  readonly removeParticipant: (id: string) => void;
  readonly setMe: (id: string | null) => void;
  readonly setLocale: (l: 'en' | 'de') => void;
  readonly loadSample: () => void;
  readonly clearAll: () => void;
}

const empty: Omit<State, 'hydrated'> = {
  trip: { id: 'local', name: 'My trip', ccy: 'EUR', timezone: 'Europe/Berlin' },
  participants: [],
  entries: [],
  meId: null,
  locale: null,
};

export const useStore = create<State & Actions>()(
  persist(
    (set) => ({
      ...empty,
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      addEntry: (e) => set((s) => ({ entries: [...s.entries, e] })),
      updateEntry: (e) => set((s) => ({ entries: s.entries.map((x) => (x.id === e.id ? e : x)) })),
      deleteEntry: (id) => set((s) => ({ entries: s.entries.map((x) => (x.id === id ? { ...x, deleted: true } : x)) })),
      addParticipant: (p) => set((s) => ({ participants: [...s.participants, p] })),
      removeParticipant: (id) => set((s) => ({ participants: s.participants.filter((p) => p.id !== id), meId: s.meId === id ? null : s.meId })),
      setMe: (meId) => set({ meId }),
      setLocale: (locale) => set({ locale }),
      loadSample: () => set({ ...sampleTrip(), meId: null }),
      clearAll: () => set({ ...empty }),
    }),
    {
      name: 'trip-ledger:v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ trip: s.trip, participants: s.participants, entries: s.entries, meId: s.meId, locale: s.locale }),
      onRehydrateStorage: () => (state) => { state?.setHydrated(); },
    },
  ),
);

