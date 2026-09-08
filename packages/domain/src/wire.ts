/**
 * Wire / storage form of ledger data: every money value is a decimal string
 * (P6). Used by the client's local store now and by the API contracts later.
 */
import { type LedgerEntry, type Payment } from './ledger';
import { type Currency, currency, moneyFromString, moneyToString, preciseFromString, preciseToString } from './money';
import { type ParticipantId, type Share, type SplitRule, type Surcharge } from './split';
import { localDate } from './ports';

/**
 * How an entry was split, kept alongside the shares it produced (FR-3.5, FR-3.7).
 *
 * The shares alone cannot say whether "€30 each" was an equal split, a 1:1:1
 * weighting or three typed amounts — so reopening an entry used to guess, and
 * always guessed "exact". Storing the intent lets the form come back the way it
 * was left, and lets an edit re-apply the rule to a new total.
 *
 * Weights and basis points are decimal strings for the same reason money is:
 * JSON has no integers of arbitrary size (P6). They travel as ORDERED ARRAYS
 * rather than maps: `allocate` walks the rule in key order and `roundAll`'s
 * tie-break is positional, while jsonb reorders object keys as it pleases — so a
 * map would let a round-trip through the database hand the residual cent to a
 * different person.
 */
export interface WireRuleEntry { readonly participantId: string; readonly value: string }

export type WireSplitRule =
  | { readonly kind: 'equal'; readonly among: readonly string[] }
  | { readonly kind: 'weights'; readonly weights: readonly WireRuleEntry[] }
  | { readonly kind: 'percent'; readonly bps: readonly WireRuleEntry[] }
  | { readonly kind: 'exact'; readonly amounts: readonly WireRuleEntry[] };

export interface WireSurcharge { readonly participantId: string; readonly amount: string }

/** The rule plus anything added per person on top of it — everything `allocate` needs. */
export interface WireSplit { readonly rule: WireSplitRule; readonly surcharges?: readonly WireSurcharge[] }

export interface WirePayment { readonly participantId: string; readonly amount: string }
export interface WireShare { readonly participantId: string; readonly amount: string; /** id of the transfer that settled this share (FR-7.4, P7) */ readonly settledBy?: string }
export interface WireEntry {
  readonly id: string;
  readonly type: LedgerEntry['type'];
  readonly description: string;
  readonly amount: string;
  readonly ccy: string;
  readonly date: string;
  readonly payments: readonly WirePayment[];
  readonly shares: readonly WireShare[];
  readonly reason?: string;
  readonly category?: string;
  /** Present when the client recorded how it split; absent on older entries. */
  readonly split?: WireSplit;
  readonly createdAt: string;
  readonly deleted?: boolean;
}

/** A ledger entry as the client holds it: the domain shape plus display fields. */
export interface Entry extends LedgerEntry {
  readonly description: string;
  readonly createdAt: string;
  readonly category?: string;
  readonly split?: { readonly rule: SplitRule; readonly surcharges?: readonly Surcharge[] };
  /** participantId → id of the transfer that settled that share */
  readonly settled?: Readonly<Record<string, string>>;
}

const toEntries = <A>(o: Readonly<Record<string, A>>, f: (a: A) => string): WireRuleEntry[] =>
  Object.entries(o).map(([participantId, v]) => ({ participantId, value: f(v) }));

/** Rebuilds the record in array order; JS keeps string keys in insertion order, `allocate` reads them that way. */
const fromEntries = <B>(rows: readonly WireRuleEntry[], f: (v: string) => B): Record<ParticipantId, B> =>
  Object.fromEntries(rows.map((r) => [r.participantId, f(r.value)]));

export function splitRuleToWire(r: SplitRule): WireSplitRule {
  switch (r.kind) {
    case 'equal': return { kind: 'equal', among: [...r.among] };
    case 'weights': return { kind: 'weights', weights: toEntries(r.weights, (w) => w.toString()) };
    case 'percent': return { kind: 'percent', bps: toEntries(r.bps, (b) => b.toString()) };
    case 'exact': return { kind: 'exact', amounts: toEntries(r.amounts, moneyToString) };
  }
}

export function splitRuleFromWire(w: WireSplitRule, ccy: Currency): SplitRule {
  switch (w.kind) {
    case 'equal': return { kind: 'equal', among: w.among as ParticipantId[] };
    case 'weights': return { kind: 'weights', weights: fromEntries(w.weights, BigInt) };
    case 'percent': return { kind: 'percent', bps: fromEntries(w.bps, BigInt) };
    case 'exact': return { kind: 'exact', amounts: fromEntries(w.amounts, (a) => moneyFromString(a, ccy)) };
  }
}

export function entryToWire(e: Entry): WireEntry {
  return {
    id: e.id, type: e.type, description: e.description,
    amount: moneyToString(e.amount), ccy: e.amount.ccy.code, date: e.date,
    payments: e.payments.map((p) => ({ participantId: p.participantId, amount: moneyToString(p.amount) })),
    shares: e.shares.map((s) => ({ participantId: s.participantId, amount: preciseToString(s.amount), ...(e.settled?.[s.participantId] ? { settledBy: e.settled[s.participantId] } : {}) })),
    ...(e.reason !== undefined ? { reason: e.reason } : {}),
    ...(e.category !== undefined ? { category: e.category } : {}),
    ...(e.split ? { split: {
      rule: splitRuleToWire(e.split.rule),
      ...(e.split.surcharges?.length ? { surcharges: e.split.surcharges.map((x) => ({ participantId: x.participantId, amount: moneyToString(x.amount) })) } : {}),
    } } : {}),
    createdAt: e.createdAt,
    ...(e.deleted ? { deleted: true } : {}),
  };
}

export function entryFromWire(w: WireEntry): Entry {
  const ccy: Currency = currency(w.ccy);
  const payments: Payment[] = w.payments.map((p) => ({ participantId: p.participantId as ParticipantId, amount: moneyFromString(p.amount, ccy) }));
  const shares: Share[] = w.shares.map((s) => ({ participantId: s.participantId as ParticipantId, amount: preciseFromString(s.amount, ccy) }));
  const settledPairs = w.shares.filter((s) => s.settledBy).map((s) => [s.participantId, s.settledBy as string] as const);
  return {
    id: w.id, type: w.type, description: w.description,
    amount: moneyFromString(w.amount, ccy), date: localDate(w.date),
    payments, shares,
    ...(w.reason !== undefined ? { reason: w.reason } : {}),
    ...(w.category !== undefined ? { category: w.category } : {}),
    ...(w.split ? { split: {
      rule: splitRuleFromWire(w.split.rule, ccy),
      ...(w.split.surcharges?.length ? { surcharges: w.split.surcharges.map((x) => ({ participantId: x.participantId as ParticipantId, amount: moneyFromString(x.amount, ccy) })) } : {}),
    } } : {}),
    ...(settledPairs.length ? { settled: Object.fromEntries(settledPairs) } : {}),
    createdAt: w.createdAt,
    ...(w.deleted ? { deleted: true } : {}),
  };
}
