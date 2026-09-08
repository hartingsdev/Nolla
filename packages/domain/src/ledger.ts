/**
 * Ledger, balances and the gross debt matrix — requirements §5, §7,
 * invariants I1, I2, I4, FR-7.1, FR-8.1.
 *
 * Every entry type has the same shape — payments in, shares out — so one loop
 * computes balances for expenses, transfers and adjustments alike, and I2
 * (Σ balances == 0) follows from I1.
 */

import { DomainError } from './errors.js';
import { type Currency, type Money, type Precise, M, P, floorDiv, precise, toPrecise, zeroMoney, zeroPrecise } from './money.js';
import { type ParticipantId, type Share } from './split.js';
import { type LocalDate } from './ports.js';

export type EntryType = 'expense' | 'transfer' | 'adjustment';

export interface Payment {
  readonly participantId: ParticipantId;
  readonly amount: Money;
}

/** The part of an entry the money rules need. Persistence adds the rest. */
export interface LedgerEntry {
  readonly id: string;
  readonly type: EntryType;
  readonly amount: Money;
  readonly date: LocalDate;
  readonly payments: readonly Payment[];
  readonly shares: readonly Share[];
  /** Mandatory for adjustments (FR-6.1). */
  readonly reason?: string;
  readonly deleted?: boolean;
}

// ---------------------------------------------------------------------------
// Validation (I1 and the per-type rules)
// ---------------------------------------------------------------------------

export function validateEntry(e: LedgerEntry): void {
  const ccy = e.amount.ccy;
  const paySum = M.sum(e.payments.map((p) => p.amount), ccy);
  if (!M.eq(paySum, e.amount)) {
    throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: Σ payments != amount`, { entryId: e.id });
  }
  const shareSum = P.sum(e.shares.map((s) => s.amount), ccy);
  if (!P.eq(shareSum, toPrecise(e.amount))) {
    throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: Σ shares != amount`, { entryId: e.id });
  }
  const sign = e.amount.minor < 0n ? -1n : 1n;
  if (e.payments.some((p) => p.amount.minor * sign < 0n)) {
    throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: payments must not oppose the sign of the amount`, { entryId: e.id });
  }
  if (e.payments.length === 0 || e.shares.length === 0) {
    throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: needs at least one payment and one share`, { entryId: e.id });
  }
  if (hasDuplicates(e.payments.map((p) => p.participantId)) || hasDuplicates(e.shares.map((s) => s.participantId))) {
    throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: duplicate participant`, { entryId: e.id });
  }
  if (e.type === 'adjustment' && !e.reason?.trim()) {
    throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: adjustment needs a reason`, { entryId: e.id });
  }
  if (e.type === 'transfer') {
    if (e.payments.length !== 1 || e.shares.length !== 1) {
      throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: a transfer has exactly one sender and one recipient`, { entryId: e.id });
    }
    if (e.payments[0]?.participantId === e.shares[0]?.participantId) {
      throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: cannot transfer to oneself`, { entryId: e.id });
    }
    if (e.amount.minor <= 0n) {
      throw new DomainError('INVARIANT_VIOLATION', `entry ${e.id}: a transfer must be positive`, { entryId: e.id });
    }
  }
}

function hasDuplicates(xs: readonly string[]): boolean {
  return new Set(xs).size !== xs.length;
}

// ---------------------------------------------------------------------------
// Balances (FR-7.1, FR-9.3) and trip cost (I4)
// ---------------------------------------------------------------------------

export type Balances = ReadonlyMap<ParticipantId, Precise>;

const live = (entries: readonly LedgerEntry[]): LedgerEntry[] => entries.filter((e) => !e.deleted);

/** Σ payments − Σ shares, per participant, over every live entry. Positive = is owed. */
export function balances(entries: readonly LedgerEntry[], ccy: Currency): Balances {
  const out = new Map<ParticipantId, Precise>();
  const bump = (id: ParticipantId, delta: Precise) => out.set(id, P.add(out.get(id) ?? zeroPrecise(ccy), delta));
  for (const e of live(entries)) {
    for (const p of e.payments) bump(p.participantId, toPrecise(p.amount));
    for (const s of e.shares) bump(s.participantId, P.neg(s.amount));
  }
  return out;
}

/** What the trip cost: expenses only (I4). Reimbursements are negative expenses and reduce it. */
export function tripCost(entries: readonly LedgerEntry[], ccy: Currency): Money {
  return M.sum(live(entries).filter((e) => e.type === 'expense').map((e) => e.amount), ccy);
}

/** Per-participant totals for the overview (FR-7.1): what they paid, what they owe. */
export interface ParticipantTotals {
  readonly paid: Money;       // expense payments only
  readonly owed: Precise;     // expense shares only
  readonly balance: Precise;  // over every entry type
}

export function participantTotals(entries: readonly LedgerEntry[], ccy: Currency): ReadonlyMap<ParticipantId, ParticipantTotals> {
  const paid = new Map<ParticipantId, Money>();
  const owed = new Map<ParticipantId, Precise>();
  for (const e of live(entries)) {
    if (e.type !== 'expense') continue;
    for (const p of e.payments) paid.set(p.participantId, M.add(paid.get(p.participantId) ?? zeroMoney(ccy), p.amount));
    for (const s of e.shares) owed.set(s.participantId, P.add(owed.get(s.participantId) ?? zeroPrecise(ccy), s.amount));
  }
  const bal = balances(entries, ccy);
  const ids = new Set<ParticipantId>([...paid.keys(), ...owed.keys(), ...bal.keys()]);
  const out = new Map<ParticipantId, ParticipantTotals>();
  for (const id of ids) {
    out.set(id, {
      paid: paid.get(id) ?? zeroMoney(ccy),
      owed: owed.get(id) ?? zeroPrecise(ccy),
      balance: bal.get(id) ?? zeroPrecise(ccy),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Gross debt matrix (FR-8.1): D[a][b] = what a owes b, before any netting
// ---------------------------------------------------------------------------

export type GrossMatrix = ReadonlyMap<ParticipantId, ReadonlyMap<ParticipantId, Precise>>;

/**
 * For each entry, every beneficiary owes each payer a slice of their share
 * proportional to what that payer put in. A beneficiary who is also a payer
 * owes nothing to themself. The matrix and `balances` agree exactly:
 * balance(a) == Σ_b D[b][a] − Σ_b D[a][b]  (tested as a property).
 *
 * Exactness in both directions needs care: rounding each share's slices
 * independently makes rows exact but not columns. So slices are taken as
 * differences of CUMULATIVE floor apportionments: row sums telescope to each
 * share, and the final cumulative sum is the entry total, whose proportional
 * split by payment weights is exactly each payment (no remainder).
 */
export function grossMatrix(entries: readonly LedgerEntry[], ccy: Currency): GrossMatrix {
  const D = new Map<ParticipantId, Map<ParticipantId, Precise>>();
  const add = (from: ParticipantId, to: ParticipantId, amt: bigint) => {
    if (amt === 0n || from === to) return;
    if (amt < 0n) { add(to, from, -amt); return; }
    let row = D.get(from);
    if (!row) { row = new Map(); D.set(from, row); }
    row.set(to, P.add(row.get(to) ?? zeroPrecise(ccy), precise(amt, ccy)));
  };
  const byId = (a: { participantId: string }, b: { participantId: string }) =>
    a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0;

  for (const e of live(entries)) {
    const payers = [...e.payments].filter((p) => !M.isZero(p.amount)).sort(byId);
    if (payers.length === 0) continue;
    const sign = e.amount.minor < 0n ? -1n : 1n;
    const w = payers.map((p) => p.amount.minor * sign); // all > 0
    const W = w.reduce((a, b) => a + b, 0n);
    const m = payers.length;

    let cum = 0n;
    let prev: bigint[] = new Array<bigint>(m).fill(0n);
    for (const s of [...e.shares].sort(byId)) {
      cum += s.amount.scaled;
      const cur: bigint[] = new Array<bigint>(m).fill(0n);
      let acc = 0n;
      for (let j = 0; j < m - 1; j++) { cur[j] = floorDiv(cum * (w[j] ?? 0n), W); acc += cur[j] ?? 0n; }
      cur[m - 1] = cum - acc;
      for (let j = 0; j < m; j++) {
        const slice = (cur[j] ?? 0n) - (prev[j] ?? 0n); // > 0: beneficiary owes payer j
        add(s.participantId, (payers[j] as Payment).participantId, slice);
      }
      prev = cur;
    }
  }
  return D;
}
