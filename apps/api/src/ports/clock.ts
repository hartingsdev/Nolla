import { type Clock, type LocalDate, localDate } from '@vst/domain';

export const systemClock: Clock = {
  today(timezone: string): LocalDate {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return localDate(parts);
  },
  nowMs: () => Date.now(),
};

/** Deterministic clock for tests. */
export function fixedClock(iso: string): Clock & { set(iso: string): void } {
  let now = new Date(iso);
  return {
    today: () => localDate(now.toISOString().slice(0, 10)),
    nowMs: () => now.getTime(),
    set(next: string) { now = new Date(next); },
  };
}
