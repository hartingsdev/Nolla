/**
 * Split allocation — requirements FR-3.1–3.7, invariant I1, rule P5.
 *
 * `allocate` turns an entry total and a split rule into shares that sum to the
 * total EXACTLY at Precise precision. Equal, weight and percentage splits
 * distribute the 10⁻⁸ residual by largest remainder; exact splits are typed by
 * a human in Money and are rejected unless they already sum to the total.
 */

import { DomainError } from './errors';
import {
  type Currency, type Money, type Precise,
  M, P, floorDiv, floorMod, money, precise, seedIndex, toPrecise, zeroMoney,
} from './money';

export type ParticipantId = string & { readonly __brand: 'ParticipantId' };

export type SplitRule =
  | { readonly kind: 'equal'; readonly among: readonly ParticipantId[] }
  /** Arbitrary non-negative integer weights, e.g. 2:1:1. At least one must be > 0. */
  | { readonly kind: 'weights'; readonly weights: Readonly<Record<ParticipantId, bigint>> }
  /** Percentages in basis points (1/100 of a percent): must sum to exactly 10 000. */
  | { readonly kind: 'percent'; readonly bps: Readonly<Record<ParticipantId, bigint>> }
  /** Amounts typed by a human. Must sum to the (surcharge-free) total. */
  | { readonly kind: 'exact'; readonly amounts: Readonly<Record<ParticipantId, Money>> };

/** A per-person amount added on top of the split base (tip, deposit, service charge — FR-3.7). */
export interface Surcharge {
  readonly participantId: ParticipantId;
  readonly amount: Money;
}

export interface Share {
  readonly participantId: ParticipantId;
  readonly amount: Precise;
}

export interface AllocateOptions {
  /** Rotates who absorbs the residual unit (P4). Use the entry id. */
  readonly seed: string;
  readonly surcharges?: readonly Surcharge[];
}

export const BPS_TOTAL = 10_000n;

/**
 * Allocate `total` among participants per `rule`.
 * Post-condition (I1): Σ shares == toPrecise(total), exactly.
 */
export function allocate(total: Money, rule: SplitRule, opts: AllocateOptions): Share[] {
  const ccy = total.ccy;
  const surcharges = opts.surcharges ?? [];
  const surchargeSum = M.sum(surcharges.map((s) => s.amount), ccy);
  const base = M.sub(total, surchargeSum);

  const baseShares = allocateBase(base, rule, opts.seed);

  // Add surcharges on top; a surcharge for someone outside the split creates a share for them.
  const byId = new Map<ParticipantId, Precise>(baseShares.map((s) => [s.participantId, s.amount]));
  for (const s of surcharges) {
    const current = byId.get(s.participantId) ?? precise(0n, ccy);
    byId.set(s.participantId, P.add(current, toPrecise(s.amount)));
  }
  const shares: Share[] = [...byId.entries()].map(([participantId, amount]) => ({ participantId, amount }));

  // I1, checked here so no caller can hold a share set that doesn't reconcile.
  const sum = P.sum(shares.map((s) => s.amount), ccy);
  if (!P.eq(sum, toPrecise(total))) {
    throw new DomainError('INVARIANT_VIOLATION', 'allocate produced shares that do not sum to the total');
  }
  return shares;
}

function allocateBase(base: Money, rule: SplitRule, seed: string): Share[] {
  switch (rule.kind) {
    case 'equal': {
      const ids = uniqueNonEmpty(rule.among, 'equal split needs at least one participant');
      return weighted(base, ids, ids.map(() => 1n), seed);
    }
    case 'weights': {
      const ids = uniqueNonEmpty(Object.keys(rule.weights) as ParticipantId[], 'weighted split needs at least one participant');
      const ws = ids.map((id) => rule.weights[id] ?? 0n);
      if (ws.some((w) => w < 0n)) throw new DomainError('INVALID_SPLIT', 'weights must be non-negative');
      if (ws.every((w) => w === 0n)) throw new DomainError('INVALID_SPLIT', 'at least one weight must be positive');
      return weighted(base, ids, ws, seed);
    }
    case 'percent': {
      const ids = uniqueNonEmpty(Object.keys(rule.bps) as ParticipantId[], 'percentage split needs at least one participant');
      const ws = ids.map((id) => rule.bps[id] ?? 0n);
      if (ws.some((w) => w < 0n)) throw new DomainError('INVALID_SPLIT', 'percentages must be non-negative');
      const sum = ws.reduce((a, b) => a + b, 0n);
      if (sum !== BPS_TOTAL) {
        throw new DomainError('INVALID_SPLIT', `percentages must sum to 100%, got ${String(sum)} bps`, { sumBps: sum });
      }
      return weighted(base, ids, ws, seed);
    }
    case 'exact': {
      const ids = uniqueNonEmpty(Object.keys(rule.amounts) as ParticipantId[], 'exact split needs at least one participant');
      const amounts = ids.map((id) => rule.amounts[id] ?? zeroMoney(base.ccy));
      const sum = M.sum(amounts, base.ccy);
      const residual = M.sub(base, sum);
      if (!M.isZero(residual)) {
        // The UI is expected to offer "assign remainder to …" BEFORE calling allocate (FR-3.6).
        throw new DomainError('SPLIT_RESIDUAL', 'exact amounts do not sum to the total', { residual });
      }
      return ids.map((id, i) => ({ participantId: id, amount: toPrecise(amounts[i] ?? zeroMoney(base.ccy)) }));
    }
  }
}

/**
 * Proportional allocation at Precise precision with largest-remainder
 * distribution of the 10⁻⁸ residual (P5). Tie-break rotates by `seed`.
 */
function weighted(base: Money, ids: readonly ParticipantId[], weights: readonly bigint[], seed: string): Share[] {
  const parts = apportion(toPrecise(base), weights, seed);
  return ids.map((id, i) => ({ participantId: id, amount: parts[i] ?? precise(0n, base.ccy) }));
}

/**
 * Split a Precise amount proportionally to integer weights so the parts sum
 * EXACTLY to the amount. Weights must be non-negative with a positive sum.
 * Used by `allocate` and by the ledger to apportion a share among payers.
 */
export function apportion(amount: Precise, weights: readonly bigint[], seed: string): Precise[] {
  const ccy: Currency = amount.ccy;
  const T = amount.scaled;
  const W = weights.reduce((a, b) => a + b, 0n);
  if (weights.some((w) => w < 0n) || W <= 0n) throw new DomainError('INVALID_SPLIT', 'weights must be non-negative with a positive sum');
  const n = weights.length;

  const floors: bigint[] = [];
  const rems: bigint[] = [];
  let floorSum = 0n;
  for (let i = 0; i < n; i++) {
    const num = T * (weights[i] ?? 0n);
    const q = floorDiv(num, W);
    floors.push(q);
    rems.push(floorMod(num, W));
    floorSum += q;
  }
  let residual = T - floorSum; // 0 ≤ residual < n (units of 10⁻⁸)

  const start = seedIndex(seed, n);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const ra = rems[a] ?? 0n;
    const rb = rems[b] ?? 0n;
    if (ra !== rb) return ra > rb ? -1 : 1;
    return ((a - start + n) % n) - ((b - start + n) % n);
  });
  for (const i of order) {
    if (residual <= 0n) break;
    floors[i] = (floors[i] ?? 0n) + 1n;
    residual -= 1n;
  }
  return floors.map((f) => precise(f, ccy));
}

function uniqueNonEmpty(ids: readonly ParticipantId[], msg: string): ParticipantId[] {
  const set = new Set(ids);
  if (set.size === 0) throw new DomainError('INVALID_SPLIT', msg);
  if (set.size !== ids.length) throw new DomainError('INVALID_SPLIT', 'duplicate participant in split');
  return [...set];
}

/** Convenience for the UI residual indicator: how far an exact split is from the total. */
export function exactResidual(total: Money, amounts: readonly Money[], surcharges: readonly Surcharge[] = []): Money {
  const base = M.sub(total, M.sum(surcharges.map((s) => s.amount), total.ccy));
  return M.sub(base, M.sum(amounts, total.ccy));
}

/** Re-export for callers that only need the type. */
export { money };
