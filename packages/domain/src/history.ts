/**
 * What changed between two revisions of an entry (FR-10.2).
 *
 * The server keeps a snapshot of every entry before each change; this turns two
 * of those snapshots into the list of differences a person can read. Pure
 * comparison over the wire shape, so the same function serves the client, a
 * future export and any test.
 *
 * Money stays in its wire form here. The caller holds the currency and decides
 * how to print it — a share carries eight decimals (D8) and only the UI knows
 * how much of that is worth showing.
 */
import { type WireEntry } from './wire';

/** Single-valued fields of an entry, in the order a reader scans them. */
export const SCALAR_FIELDS = ['type', 'description', 'amount', 'date', 'category', 'reason', 'deleted'] as const;
export type ScalarField = (typeof SCALAR_FIELDS)[number];

export interface FieldChange { readonly field: ScalarField; readonly from: string; readonly to: string }

/** A participant's payment or share, before and after. `null` means they were not on the entry. */
export interface PartyChange { readonly participantId: string; readonly from: string | null; readonly to: string | null }

export interface EntryDiff {
  readonly fields: readonly FieldChange[];
  readonly payments: readonly PartyChange[];
  readonly shares: readonly PartyChange[];
}

const scalar = (e: WireEntry, f: ScalarField): string => {
  switch (f) {
    case 'type': return e.type;
    case 'description': return e.description;
    case 'amount': return e.amount;
    case 'date': return e.date;
    case 'category': return e.category ?? '';
    case 'reason': return e.reason ?? '';
    case 'deleted': return e.deleted ? 'true' : 'false';
  }
};

/** participantId → amount, for one side of an entry. */
const byParticipant = (rows: readonly { participantId: string; amount: string }[]): Map<string, string> =>
  new Map(rows.map((r) => [r.participantId, r.amount]));

function partyChanges(before: readonly { participantId: string; amount: string }[], after: readonly { participantId: string; amount: string }[]): PartyChange[] {
  const b = byParticipant(before);
  const a = byParticipant(after);
  const out: PartyChange[] = [];
  // Order by the entry's own order — the one the client showed — with removals last.
  for (const id of [...a.keys(), ...[...b.keys()].filter((k) => !a.has(k))]) {
    const from = b.get(id) ?? null;
    const to = a.get(id) ?? null;
    if (from !== to) out.push({ participantId: id, from, to });
  }
  return out;
}

export function entryDiff(before: WireEntry, after: WireEntry): EntryDiff {
  return {
    fields: SCALAR_FIELDS.flatMap((field) => {
      const from = scalar(before, field);
      const to = scalar(after, field);
      return from === to ? [] : [{ field, from, to }];
    }),
    payments: partyChanges(before.payments, after.payments),
    shares: partyChanges(before.shares, after.shares),
  };
}

/** Nothing a person would want to be told about. */
export function isEmptyDiff(d: EntryDiff): boolean {
  return d.fields.length === 0 && d.payments.length === 0 && d.shares.length === 0;
}
