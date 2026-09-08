import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DomainError, M, P, currency, money, moneyFromString, moneyToString, precise,
  preciseFromString, preciseToString, roundAll, toPrecise, PRECISE_SCALE, floorDiv, floorMod,
} from './index.js';

const EUR = currency('EUR');
const JPY = currency('JPY');
const BHD = currency('BHD');
const CCYS = [EUR, JPY, BHD];

const arbCcy = fc.constantFrom(...CCYS);
const arbMinor = fc.bigInt({ min: -10_000_000n, max: 10_000_000n });
const arbScaled = fc.bigInt({ min: -(10n ** 14n), max: 10n ** 14n });
const arbSeed = fc.string();

describe('serialisation (P6)', () => {
  it('Money round-trips through its string form', () => {
    fc.assert(fc.property(arbCcy, arbMinor, (ccy, minor) => {
      const m = money(minor, ccy);
      expect(moneyFromString(moneyToString(m), ccy)).toEqual(m);
    }));
  });
  it('Precise round-trips through its string form', () => {
    fc.assert(fc.property(arbCcy, arbScaled, (ccy, scaled) => {
      const p = precise(scaled, ccy);
      expect(preciseFromString(preciseToString(p), ccy)).toEqual(p);
    }));
  });
  it('formats with the currency exponent', () => {
    expect(moneyToString(money(5518n, EUR))).toBe('55.18');
    expect(moneyToString(money(-875n, EUR))).toBe('-8.75');
    expect(moneyToString(money(5n, EUR))).toBe('0.05');
    expect(moneyToString(money(1200n, JPY))).toBe('1200');
    expect(moneyToString(money(1234n, BHD))).toBe('1.234');
    expect(preciseToString(precise(1103600000n, EUR))).toBe('11.03600000');
    expect(preciseToString(precise(-1n, EUR))).toBe('-0.00000001');
  });
  it('rejects too many fraction digits for the currency', () => {
    expect(() => moneyFromString('1.005', EUR)).toThrow(DomainError);
    expect(() => moneyFromString('1.5', JPY)).toThrow(DomainError);
    expect(() => preciseFromString('1.5', EUR)).toThrow(DomainError);
    expect(() => moneyFromString('1e3', EUR)).toThrow(DomainError);
    expect(() => moneyFromString('NaN', EUR)).toThrow(DomainError);
  });
  it('accepts fewer fraction digits for Money', () => {
    expect(moneyFromString('55', EUR)).toEqual(money(5500n, EUR));
    expect(moneyFromString('55.1', EUR)).toEqual(money(5510n, EUR));
  });
});

describe('toPrecise (P2)', () => {
  it('is lossless and currency-aware', () => {
    expect(toPrecise(money(5518n, EUR)).scaled).toBe(5518n * 10n ** 6n);
    expect(toPrecise(money(1200n, JPY)).scaled).toBe(1200n * PRECISE_SCALE);
    expect(toPrecise(money(1234n, BHD)).scaled).toBe(1234n * 10n ** 5n);
  });
  it('preserves sums', () => {
    fc.assert(fc.property(arbCcy, fc.array(arbMinor), (ccy, minors) => {
      const ms = minors.map((x) => money(x, ccy));
      expect(P.eq(P.sum(ms.map(toPrecise), ccy), toPrecise(M.sum(ms, ccy)))).toBe(true);
    }));
  });
});

describe('floor arithmetic', () => {
  it('floorDiv/floorMod satisfy n = q*d + r with 0 ≤ r < d', () => {
    fc.assert(fc.property(fc.bigInt(), fc.bigInt({ min: 1n, max: 10n ** 12n }), (n, d) => {
      const q = floorDiv(n, d); const r = floorMod(n, d);
      expect(q * d + r).toBe(n);
      expect(r >= 0n && r < d).toBe(true);
    }));
  });
});

describe('roundAll — the Precise → Money boundary (P3, P4)', () => {
  /** Generates n Precise values that sum exactly to a Money total (the caller's precondition). */
  const arbValuesWithTotal = arbCcy.chain((ccy) =>
    fc.tuple(fc.integer({ min: 1, max: 12 }), arbMinor).chain(([n, totalMinor]) => {
      const total = money(totalMinor, ccy);
      const T = toPrecise(total).scaled;
      // n-1 free values, last one fixed so the sum is exact
      return fc.array(arbScaled, { minLength: n - 1, maxLength: n - 1 }).map((free) => {
        const last = T - free.reduce((a, b) => a + b, 0n);
        return { ccy, total, values: [...free, last].map((s) => precise(s, ccy)) };
      });
    }),
  );

  it('results sum exactly to the total', () => {
    fc.assert(fc.property(arbValuesWithTotal, arbSeed, ({ ccy, total, values }, seed) => {
      const out = roundAll(values, total, seed);
      expect(out).toHaveLength(values.length);
      expect(M.eq(M.sum(out, ccy), total)).toBe(true);
    }));
  });

  it('never moves any value by a full minor unit or more', () => {
    fc.assert(fc.property(arbValuesWithTotal, arbSeed, ({ total, values }, seed) => {
      const out = roundAll(values, total, seed);
      out.forEach((m, i) => {
        const diff = P.sub(toPrecise(m), values[i] as never);
        const unit = toPrecise(money(1n, total.ccy)).scaled;
        expect(diff.scaled > -unit && diff.scaled < unit).toBe(true);
      });
    }));
  });

  it('is deterministic, and seeds only permute who takes the extra unit', () => {
    fc.assert(fc.property(arbValuesWithTotal, arbSeed, arbSeed, ({ total, values }, s1, s2) => {
      const a = roundAll(values, total, s1);
      const b = roundAll(values, total, s1);
      const c = roundAll(values, total, s2);
      expect(a).toEqual(b);
      const sorted = (xs: ReturnType<typeof roundAll>) => xs.map((m) => m.minor).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
      expect(sorted(a)).toEqual(sorted(c));
    }));
  });

  it('rejects a set that does not sum to the total (a caller bug, not an input error)', () => {
    expect(() => roundAll([precise(1n, EUR)], money(0n, EUR), 'x')).toThrow(DomainError);
  });

  it('€55.18 / 5 → three at 11.04, two at 11.03, and the seed decides which two', () => {
    const share = precise(1103600000n, EUR); // 11.036
    const values = [share, share, share, share, share];
    const out = roundAll(values, money(5518n, EUR), 'entry-1');
    expect(out.map((m) => m.minor).sort()).toEqual([1103n, 1103n, 1104n, 1104n, 1104n]);
    const other = roundAll(values, money(5518n, EUR), 'entry-2');
    // same multiset, and there exists a seed that rotates it
    expect(other.map((m) => m.minor).sort()).toEqual([1103n, 1103n, 1104n, 1104n, 1104n]);
  });

  it('rotates fairly: over many seeds every position takes the short share sometimes', () => {
    const share = precise(1103600000n, EUR);
    const values = [share, share, share, share, share];
    const shortCount = [0, 0, 0, 0, 0];
    for (let k = 0; k < 200; k++) {
      roundAll(values, money(5518n, EUR), `seed-${String(k)}`).forEach((m, i) => { if (m.minor === 1103n) shortCount[i]!++; });
    }
    expect(shortCount.every((c) => c > 0)).toBe(true);
  });

  it('handles a zero-sum vector (the settlement case), negatives included', () => {
    const v = [precise(1103600000n, EUR), precise(-551800000n, EUR), precise(-551800000n, EUR)];
    const out = roundAll(v, money(0n, EUR), 's');
    expect(M.sum(out, EUR).minor).toBe(0n);
  });
});
