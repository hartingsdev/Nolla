/** ISO calendar date, `YYYY-MM-DD`, interpreted in the trip's timezone. */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

export function localDate(s: string): LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`not a calendar date: ${s}`);
  return s as LocalDate;
}

/** Time enters the domain only through this port (architecture.md §4). */
export interface Clock {
  today(timezone: string): LocalDate;
  /** Milliseconds since epoch, for timestamps the domain must stamp. */
  nowMs(): number;
}

/** Identity generation enters the domain only through this port. */
export interface IdGen {
  /** UUIDv7 — time-ordered, safe to generate on the client. */
  next(): string;
}
