import { useMemo } from 'react';
import {
  type Entry, type ParticipantId, type PlanOptions, balances, currency, entryFromWire, grossMatrix,
  roundAll, settle, tripCost, zeroMoney, type Money, type Precise,
} from '@vst/domain';
import { type TripState, useStore } from './store';

export function useTrip(): TripState {
  const t = useStore((s) => s.trips[s.activeTripId]);
  if (!t) throw new Error('active trip missing');
  return t;
}
export const useParticipants = () => useStore((s) => s.trips[s.activeTripId]?.participants ?? []);
/** Explicit choice, else the participant claimed by the signed-in user (the creator, or after an invite). */
export const useMeId = () => useStore((s) => {
  const t = s.trips[s.activeTripId];
  if (!t) return null;
  return t.meId ?? t.participants.find((p) => s.auth !== null && p.userId === s.auth.userId)?.id ?? null;
});
export const useTripMeta = () => useStore((s) => s.trips[s.activeTripId]?.meta);

export function useCcy() {
  const code = useStore((s) => s.trips[s.activeTripId]?.meta.ccy ?? 'EUR');
  return useMemo(() => currency(code), [code]);
}

export function useEntries(): Entry[] {
  const wire = useStore((s) => s.trips[s.activeTripId]?.entries);
  return useMemo(() => (wire ?? []).map(entryFromWire), [wire]);
}

export function useLiveEntries(): Entry[] {
  const all = useEntries();
  return useMemo(() => all.filter((e) => !e.deleted).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1)), [all]);
}

/** Exact balances plus the rounded-as-a-set Money view (P4), which is what screens show. */
export function useBalances(): { exact: ReadonlyMap<ParticipantId, Precise>; shown: ReadonlyMap<ParticipantId, Money>; cost: Money } {
  const entries = useEntries();
  const ccy = useCcy();
  const participants = useParticipants();
  return useMemo(() => {
    const exact = balances(entries, ccy);
    const ids = participants.map((p) => p.id as ParticipantId);
    const values = ids.map((id) => exact.get(id) ?? { kind: 'precise' as const, scaled: 0n, ccy });
    const rounded = roundAll(values, zeroMoney(ccy), 'balances');
    const shown = new Map<ParticipantId, Money>(ids.map((id, i) => [id, rounded[i] ?? zeroMoney(ccy)]));
    return { exact, shown, cost: tripCost(entries, ccy) };
  }, [entries, ccy, participants]);
}

export function usePlan(opts: PlanOptions | { kind: 'bilateral' }) {
  const entries = useEntries();
  const ccy = useCcy();
  const { exact } = useBalances();
  return useMemo(() => {
    const full: PlanOptions = opts.kind === 'bilateral' ? { kind: 'bilateral', matrix: grossMatrix(entries, ccy) } : opts;
    return settle(exact, ccy, full, 'trip');
  }, [entries, ccy, exact, opts]);
}

export function useNames(): Map<string, string> {
  const participants = useParticipants();
  return useMemo(() => new Map(participants.map((p) => [p.id, p.name])), [participants]);
}

/** Which writes the trip's status admits right now (FR-8.7). */
export function useWriteRules() {
  const status = useStore((s) => s.trips[s.activeTripId]?.meta.status ?? 'open');
  return { status, canWriteExpense: status === 'open', canWriteTransfer: status !== 'closed', canEdit: status === 'open', readOnly: status === 'closed' };
}

/** True when every rounded balance is zero — the precondition for closing (I5). */
export function useAllSettled(): boolean {
  const { shown } = useBalances();
  return [...shown.values()].every((m) => m.minor === 0n);
}
