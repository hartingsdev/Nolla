/**
 * Settlement plans — requirements §7, FR-8.2, FR-8.3, FR-8.5, FR-9.6, P3/P4.
 *
 * Balances enter as Precise and leave as Money: this is where exactness ends,
 * because the output is a list of real transfers. The balance vector is rounded
 * ONCE with `roundAll` (so it still sums to zero), the rounding deltas are
 * reported for the UI, and then one of three matchers runs.
 */

import { DomainError } from './errors';
import { type Currency, type Money, type Precise, M, P, money, precise, roundAll, toPrecise, zeroMoney } from './money';
import { type ParticipantId } from './split';
import { type Balances, type GrossMatrix } from './ledger';

export interface Transfer {
  readonly from: ParticipantId;
  readonly to: ParticipantId;
  readonly amount: Money;
}

export interface Plan {
  readonly kind: 'bilateral' | 'optimal' | 'hub';
  readonly transfers: readonly Transfer[];
  /** Rounded balances the plan clears; Σ == 0. */
  readonly balances: ReadonlyMap<ParticipantId, Money>;
  /** rounded − exact, for every participant whose balance was not already whole (FR-9.6). */
  readonly rounding: ReadonlyMap<ParticipantId, Precise>;
  /** Whether the matcher is guaranteed minimal (exact search) or a heuristic (greedy). */
  readonly minimal: boolean;
}

export type PlanOptions =
  | { readonly kind: 'bilateral'; readonly matrix: GrossMatrix }
  | { readonly kind: 'optimal' }
  | { readonly kind: 'hub'; readonly hub: ParticipantId };

/** Above this size the exact search gives way to greedy (architecture.md §4.4). */
export const EXACT_LIMIT = 16;

export function settle(bal: Balances, ccy: Currency, opts: PlanOptions, seed: string): Plan {
  // 1. Round once, as a set, so the rounded balances still sum to zero (P4).
  const ids = [...bal.keys()].sort();
  const exact = ids.map((id) => bal.get(id) ?? precise(0n, ccy));
  const rounded = roundAll(exact, zeroMoney(ccy), seed);
  const balances = new Map<ParticipantId, Money>();
  const rounding = new Map<ParticipantId, Precise>();
  ids.forEach((id, i) => {
    const r = rounded[i] ?? zeroMoney(ccy);
    const x = exact[i] ?? precise(0n, ccy);
    balances.set(id, r);
    const delta = P.sub(toPrecise(r), x);
    if (!P.isZero(delta)) rounding.set(id, delta);
  });

  // 2. Match.
  switch (opts.kind) {
    case 'bilateral': return finish('bilateral', bilateral(opts.matrix, balances, ccy), balances, rounding, false);
    case 'optimal': {
      const nonZero = ids.filter((id) => !M.isZero(balances.get(id) ?? zeroMoney(ccy)));
      const vec = nonZero.map((id) => (balances.get(id) ?? zeroMoney(ccy)).minor);
      const exactSearch = nonZero.length <= EXACT_LIMIT;
      const groups = exactSearch ? zeroSumGroups(vec) : [nonZero.map((_, i) => i)];
      const transfers: Transfer[] = [];
      for (const g of groups) transfers.push(...greedy(g.map((i) => [nonZero[i] as ParticipantId, vec[i] as bigint]), ccy));
      return finish('optimal', transfers, balances, rounding, exactSearch);
    }
    case 'hub': return finish('hub', hub(balances, opts.hub, ccy), balances, rounding, false);
  }
}

function finish(kind: Plan['kind'], transfers: Transfer[], balances: Map<ParticipantId, Money>, rounding: Map<ParticipantId, Precise>, minimal: boolean): Plan {
  const sorted = [...transfers]
    .filter((t) => t.amount.minor > 0n)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  return { kind, transfers: sorted, balances, rounding, minimal };
}

// ---------------------------------------------------------------------------
// Bilateral netting (FR-8.2): net each pair of the gross matrix
// ---------------------------------------------------------------------------

function bilateral(matrix: GrossMatrix, balances: ReadonlyMap<ParticipantId, Money>, ccy: Currency): Transfer[] {
  const ids = [...balances.keys()].sort();
  const book = new TransferBook();
  // Net every unordered pair at Precise precision and round each pair on its own.
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as ParticipantId;
      const b = ids[j] as ParticipantId;
      const ab = matrix.get(a)?.get(b) ?? precise(0n, ccy);
      const ba = matrix.get(b)?.get(a) ?? precise(0n, ccy);
      const net = P.sub(ab, ba); // > 0: a pays b
      if (P.isZero(net)) continue;
      const amt = nearestMoney(P.abs(net));
      if (net.scaled > 0n) book.add(a, b, amt.minor); else book.add(b, a, amt.minor);
    }
  }
  // Independent pair rounding can leave each participant a cent or two away from their
  // rounded balance. Settle that residual vector (it sums to zero) greedily and fold the
  // fixes into the existing pair transfers, so applying the plan zeroes every balance.
  const residual = new Map<ParticipantId, bigint>();
  for (const id of ids) residual.set(id, (balances.get(id) ?? zeroMoney(ccy)).minor);
  for (const t of book.list(ccy)) {
    residual.set(t.from, (residual.get(t.from) ?? 0n) + t.amount.minor);
    residual.set(t.to, (residual.get(t.to) ?? 0n) - t.amount.minor);
  }
  const fixes = greedy([...residual.entries()].filter(([, v]) => v !== 0n), ccy);
  for (const f of fixes) book.add(f.from, f.to, f.amount.minor);
  return book.list(ccy);
}

/** Directed transfer amounts keyed by (from, to); adding a reverse amount nets instead of duplicating. */
class TransferBook {
  private readonly m = new Map<string, bigint>();
  add(from: ParticipantId, to: ParticipantId, x: bigint): void {
    if (x === 0n) return;
    if (x < 0n) { this.add(to, from, -x); return; }
    const rev = `${to}|${from}`;
    const back = this.m.get(rev) ?? 0n;
    if (back > 0n) {
      if (back >= x) { this.set(rev, back - x); return; }
      this.set(rev, 0n); x -= back;
    }
    const key = `${from}|${to}`;
    this.set(key, (this.m.get(key) ?? 0n) + x);
  }
  private set(key: string, v: bigint): void { if (v === 0n) this.m.delete(key); else this.m.set(key, v); }
  list(ccy: Currency): Transfer[] {
    return [...this.m.entries()].map(([k, v]) => {
      const [from, to] = k.split('|') as [ParticipantId, ParticipantId];
      return { from, to, amount: money(v, ccy) };
    });
  }
}

/**
 * Nearest Money to a single Precise (half away from zero). For DISPLAY of a lone
 * value and the pairwise bilateral view only — never for a set that must sum to
 * a total (use roundAll, P4).
 */
export function nearestMoney(x: Precise): Money {
  const f = 10n ** BigInt(8 - x.ccy.exponent);
  const q = x.scaled / f;
  const r = x.scaled - q * f;
  const half = f / 2n;
  const adj = r >= half ? 1n : r <= -half ? -1n : 0n;
  return money(q + adj, x.ccy);
}

// ---------------------------------------------------------------------------
// Optimal (FR-8.3): exact zero-sum partition for n ≤ 16, then greedy per group
// ---------------------------------------------------------------------------

/**
 * Partition indices into the maximum number of disjoint zero-sum groups.
 * dp[mask] = max over i∈mask of dp[mask∖i] + [sum(mask) == 0]; O(2ⁿ·n).
 * Reconstructing the argmax order yields an ordering whose prefix sums hit
 * zero dp[full] times; cutting there gives the groups. Verified against brute
 * force (architecture.md §4.4).
 */
export function zeroSumGroups(vec: readonly bigint[]): number[][] {
  const n = vec.length;
  if (n === 0) return [];
  if (n > 30) throw new DomainError('INVARIANT_VIOLATION', 'zeroSumGroups: n too large');
  const size = 1 << n;
  const sum = new Array<bigint>(size).fill(0n);
  const dp = new Int16Array(size);
  const choice = new Int8Array(size);
  for (let m = 1; m < size; m++) {
    const low = m & -m;
    const i = 31 - Math.clz32(low);
    sum[m] = (sum[m ^ low] ?? 0n) + (vec[i] ?? 0n);
    let best = -1; let bestI = -1;
    for (let mm = m; mm; mm &= mm - 1) {
      const lb = mm & -mm;
      const cand = dp[m ^ lb] ?? 0;
      if (cand > best) { best = cand; bestI = 31 - Math.clz32(lb); }
    }
    dp[m] = best + (sum[m] === 0n ? 1 : 0);
    choice[m] = bestI;
  }
  // Reconstruct: removal order from full mask; reversed, it is an insertion order.
  const removal: number[] = [];
  for (let m = size - 1; m; ) { const i = choice[m] ?? 0; removal.push(i); m ^= 1 << i; }
  const order = removal.reverse();
  const groups: number[][] = [];
  let cur: number[] = []; let acc = 0n;
  for (const i of order) {
    cur.push(i); acc += vec[i] ?? 0n;
    if (acc === 0n) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur); // cannot happen when Σ vec == 0, kept for safety
  return groups;
}

/** Max-debtor ↔ max-creditor matching; at most |group| − 1 transfers on a zero-sum group. */
export function greedy(group: readonly (readonly [ParticipantId, bigint])[], ccy: Currency): Transfer[] {
  const debtors = group.filter(([, v]) => v < 0n).map(([id, v]) => ({ id, left: -v }));
  const creditors = group.filter(([, v]) => v > 0n).map(([id, v]) => ({ id, left: v }));
  // Deterministic: largest first, then id.
  const byLeft = (a: { id: string; left: bigint }, b: { id: string; left: bigint }) =>
    a.left !== b.left ? (a.left > b.left ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const out: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byLeft); creditors.sort(byLeft);
    const d = debtors[0] as { id: ParticipantId; left: bigint };
    const c = creditors[0] as { id: ParticipantId; left: bigint };
    const x = d.left < c.left ? d.left : c.left;
    out.push({ from: d.id, to: c.id, amount: money(x, ccy) });
    d.left -= x; c.left -= x;
    if (d.left === 0n) debtors.shift();
    if (c.left === 0n) creditors.shift();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hub (FR-8.5): everyone settles with one pinned member
// ---------------------------------------------------------------------------

function hub(balances: ReadonlyMap<ParticipantId, Money>, hubId: ParticipantId, ccy: Currency): Transfer[] {
  if (!balances.has(hubId)) throw new DomainError('INVALID_SPLIT', `hub ${hubId} is not a participant`);
  const out: Transfer[] = [];
  for (const [id, b] of balances) {
    if (id === hubId || M.isZero(b)) continue;
    if (b.minor < 0n) out.push({ from: id, to: hubId, amount: money(-b.minor, ccy) });
    else out.push({ from: hubId, to: id, amount: b });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers for callers and tests
// ---------------------------------------------------------------------------

/** Apply a plan's transfers to its rounded balances. A correct plan returns all zeros. */
export function applyPlan(plan: Plan, ccy: Currency): Map<ParticipantId, Money> {
  const out = new Map<ParticipantId, Money>(plan.balances);
  for (const t of plan.transfers) {
    out.set(t.from, M.add(out.get(t.from) ?? zeroMoney(ccy), t.amount));
    out.set(t.to, M.sub(out.get(t.to) ?? zeroMoney(ccy), t.amount));
  }
  return out;
}
