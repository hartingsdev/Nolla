import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type Balances, type ParticipantId, type Plan, M, P, EXACT_LIMIT, applyPlan, balances, currency, greedy,
  grossMatrix, money, precise, settle, toPrecise, zeroSumGroups,
} from './index.js';
import { arbLedger, arbZeroSumVector } from './testing/gen.js';

const EUR = currency('EUR');
const pid = (s: string) => s as ParticipantId;

function assertSound(plan: Plan): void {
  // applying the plan zeroes every rounded balance
  for (const v of applyPlan(plan, EUR).values()) expect(v.minor).toBe(0n);
  // every amount positive; in the optimal plan nobody is both sender and receiver
  // (hub and bilateral route money through people by design)
  const senders = new Set(plan.transfers.map((t) => t.from));
  for (const t of plan.transfers) {
    expect(t.amount.minor > 0n).toBe(true);
    if (plan.kind === 'optimal') expect(senders.has(t.to)).toBe(false);
  }
  // rounded balances sum to zero
  expect(M.sum([...plan.balances.values()], EUR).minor).toBe(0n);
}

/** Brute-force minimum transfers for small n: n − (max number of disjoint zero-sum subsets). */
function bruteMin(vec: bigint[]): number {
  const nz = vec.filter((v) => v !== 0n); const n = nz.length;
  if (n === 0) return 0;
  const sums = new Map<number, bigint>();
  for (let m = 0; m < 1 << n; m++) sums.set(m, nz.reduce((a, v, i) => (m >> i) & 1 ? a + v : a, 0n));
  const best = new Map<number, number>([[0, 0]]);
  for (let m = 1; m < 1 << n; m++) {
    if (sums.get(m) !== 0n) continue;
    let bm = 0;
    for (let sub = m; sub; sub = (sub - 1) & m) if (sums.get(sub) === 0n && best.has(m ^ sub)) bm = Math.max(bm, best.get(m ^ sub)! + 1);
    best.set(m, bm);
  }
  return n - best.get((1 << n) - 1)!;
}

const toBalances = (vec: [ParticipantId, bigint][]): Balances => new Map(vec.map(([id, v]) => [id, toPrecise(money(v, EUR))]));

describe('zeroSumGroups (exact search)', () => {
  it('matches brute force on random small vectors', () => {
    fc.assert(fc.property(arbZeroSumVector(8, 6n), (vec) => {
      const v = vec.map(([, x]) => x).filter((x) => x !== 0n);
      const groups = zeroSumGroups(v);
      for (const g of groups) expect(g.reduce((a, i) => a + v[i]!, 0n)).toBe(0n);
      expect(groups.flat().sort((a, b) => a - b)).toEqual(v.map((_, i) => i));
      expect(v.length - groups.length).toBe(bruteMin(v));
    }), { numRuns: 500 });
  });
  it('the documented counterexample: [+2,+3,−4,−5,+4] → 3 transfers, greedy needs 4', () => {
    const v = [2n, 3n, -4n, -5n, 4n];
    expect(v.length - zeroSumGroups(v).length).toBe(3);
    const ids = v.map((_, i) => pid(`p${String(i)}`));
    expect(greedy(ids.map((id, i) => [id, v[i]!] as const), EUR)).toHaveLength(4);
    const plan = settle(toBalances(ids.map((id, i) => [id, v[i]!])), EUR, { kind: 'optimal' }, 's');
    expect(plan.transfers).toHaveLength(3);
    expect(plan.minimal).toBe(true);
    assertSound(plan);
  });
  it('n = 16 runs in well under a second', { timeout: 1000 }, () => {
    const v: bigint[] = []; let s = 0n;
    for (let i = 0; i < 15; i++) { const x = BigInt((i * 7919) % 97) - 48n; v.push(x); s += x; }
    v.push(-s);
    const groups = zeroSumGroups(v);
    expect(groups.flat()).toHaveLength(16);
  });
});

describe('settle — all three plans on random Money balance vectors', () => {
  it('every plan is sound', () => {
    fc.assert(fc.property(arbZeroSumVector(10), fc.string(), (vec, seed) => {
      const bal = toBalances(vec);
      const ids = vec.map(([id]) => id);
      assertSound(settle(bal, EUR, { kind: 'optimal' }, seed));
      assertSound(settle(bal, EUR, { kind: 'hub', hub: ids[0]! }, seed));
    }), { numRuns: 300 });
  });
  it('optimal ≤ greedy ≤ n − 1, and optimal is minimal when exact search ran', () => {
    fc.assert(fc.property(arbZeroSumVector(9, 20n), (vec) => {
      const nz = vec.filter(([, v]) => v !== 0n);
      const plan = settle(toBalances(vec), EUR, { kind: 'optimal' }, 's');
      const g = greedy(nz, EUR).length;
      expect(plan.transfers.length).toBeLessThanOrEqual(g);
      expect(g).toBeLessThanOrEqual(Math.max(0, nz.length - 1));
      expect(plan.transfers.length).toBe(bruteMin(nz.map(([, v]) => v)));
    }), { numRuns: 300 });
  });
  it('hub: every non-hub member appears in exactly one transfer, with the hub', () => {
    fc.assert(fc.property(arbZeroSumVector(10), (vec) => {
      const hub = vec[0]![0];
      const plan = settle(toBalances(vec), EUR, { kind: 'hub', hub }, 's');
      const count = new Map<ParticipantId, number>();
      for (const t of plan.transfers) {
        expect(t.from === hub || t.to === hub).toBe(true);
        const other = t.from === hub ? t.to : t.from;
        count.set(other, (count.get(other) ?? 0) + 1);
      }
      for (const [id, v] of vec) if (id !== hub && v !== 0n) expect(count.get(id)).toBe(1);
    }));
  });
  it('is deterministic', () => {
    fc.assert(fc.property(arbZeroSumVector(10), fc.string(), (vec, seed) => {
      const a = settle(toBalances(vec), EUR, { kind: 'optimal' }, seed);
      const b = settle(toBalances(vec), EUR, { kind: 'optimal' }, seed);
      expect(a.transfers).toEqual(b.transfers);
    }));
  });
  it('falls back to greedy above EXACT_LIMIT and says so', () => {
    const n = EXACT_LIMIT + 1;
    const vec: [ParticipantId, bigint][] = Array.from({ length: n - 1 }, (_, i) => [pid(`p${String(i).padStart(2, '0')}`), BigInt(i + 1)]);
    vec.push([pid('zz'), -vec.reduce((a, [, v]) => a + v, 0n)]);
    const plan = settle(toBalances(vec), EUR, { kind: 'optimal' }, 's');
    expect(plan.minimal).toBe(false);
    assertSound(plan);
  });
});

describe('settle — rounding boundary (P3/P4/FR-9.6)', () => {
  it('reports who absorbed the residual, and the rounded balances sum to zero', () => {
    // 100 / 3: two owe 33.33333333, one paid 100 → balance +66.66666667... Precise from an equal split
    const ids = [pid('a'), pid('b'), pid('c')];
    const third = 100n * 10n ** 8n / 3n; // 33.33333333
    const bal: Balances = new Map([
      [ids[0]!, precise(100n * 10n ** 8n - third, EUR)],       // paid 100, owes 33.33333333  → +66.66666667
      [ids[1]!, precise(-third, EUR)],
      [ids[2]!, precise(-(100n * 10n ** 8n - 2n * third), EUR)], // gets the 10⁻⁸ residual of the split
    ]);
    expect(P.sum([...bal.values()], EUR).scaled).toBe(0n);
    const plan = settle(bal, EUR, { kind: 'optimal' }, 'trip-1');
    expect(M.sum([...plan.balances.values()], EUR).minor).toBe(0n);
    expect(plan.rounding.size).toBeGreaterThan(0);
    for (const [id, delta] of plan.rounding) {
      // the delta is what the participant gained or lost by rounding, and it is under a cent
      expect(P.abs(delta).scaled < 10n ** 6n).toBe(true);
      expect(plan.balances.has(id)).toBe(true);
    }
    assertSound(plan);
  });
});

describe('settle — bilateral on random ledgers', () => {
  it('nets pairs, is sound, and pays the person actually owed', () => {
    fc.assert(fc.property(arbLedger(EUR, { maxParticipants: 6, maxEntries: 25 }), ({ ccy, entries }) => {
      const bal = balances(entries, ccy);
      const D = grossMatrix(entries, ccy);
      const plan = settle(bal, ccy, { kind: 'bilateral', matrix: D }, 'trip');
      assertSound(plan);
      // at most one transfer per unordered pair
      const pairs = new Set(plan.transfers.map((t) => [t.from, t.to].sort().join('|')));
      expect(pairs.size).toBe(plan.transfers.length);
    }), { numRuns: 200 });
  });
  it('the sheet: Max owes Yannik 21.88, Yannik owes Max 11.75 → Max pays Yannik 10.13', () => {
    const [Y, MX] = [pid('yannik'), pid('max')];
    const D = new Map([
      [MX, new Map([[Y, toPrecise(money(2188n, EUR))]])],
      [Y, new Map([[MX, toPrecise(money(1175n, EUR))]])],
    ]);
    const bal: Balances = new Map([[Y, toPrecise(money(1013n, EUR))], [MX, toPrecise(money(-1013n, EUR))]]);
    const plan = settle(bal, EUR, { kind: 'bilateral', matrix: D }, 's');
    expect(plan.transfers).toEqual([{ from: MX, to: Y, amount: money(1013n, EUR) }]);
  });
});
