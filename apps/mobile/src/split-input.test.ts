import { describe, expect, it } from 'vitest';
import { BPS_TOTAL } from '@vst/domain';
import { bpsToText, parseBps, parseWeight, seedPercents } from './split-input';

describe('parseWeight', () => {
  it('reads whole shares and treats an untouched row as one', () => {
    expect(parseWeight('2')).toBe(2n);
    expect(parseWeight(undefined)).toBe(1n);
    expect(parseWeight('')).toBe(0n);          // cleared on purpose: no share
    expect(parseWeight('1.5')).toBe(15n);      // no fractional shares; digits only
    expect(parseWeight('99999999')).toBe(9999n); // capped, so one keypress cannot explode the split
  });
});

describe('parseBps', () => {
  it('reads percentages in either decimal separator', () => {
    expect(parseBps('33.34')).toBe(3334n);
    expect(parseBps('33,34')).toBe(3334n);
    expect(parseBps('20')).toBe(2000n);
    expect(parseBps('.5')).toBe(50n);
    expect(parseBps('')).toBe(0n);
    expect(parseBps(undefined)).toBe(0n);
    expect(parseBps('12.345')).toBe(1234n);    // two decimals is the resolution
  });
});

describe('bpsToText', () => {
  it('trims the fraction only when it is entirely zero', () => {
    expect(bpsToText(2000n, 'en')).toBe('20');
    expect(bpsToText(3334n, 'en')).toBe('33.34');
    expect(bpsToText(1250n, 'en')).toBe('12.5');
    expect(bpsToText(5n, 'en')).toBe('0.05');
    expect(bpsToText(0n, 'en')).toBe('0');
  });
  it('writes the separator the German keyboard produces', () => {
    expect(bpsToText(3334n, 'de')).toBe('33,34');
    expect(bpsToText(2000n, 'de')).toBe('20');
  });
  it('round-trips through parseBps', () => {
    for (const bps of [0n, 5n, 50n, 1250n, 2000n, 3333n, 3334n, 9999n, 10000n]) {
      expect(parseBps(bpsToText(bps, 'en'))).toBe(bps);
      expect(parseBps(bpsToText(bps, 'de'))).toBe(bps);
    }
  });
});

describe('seedPercents', () => {
  it('always adds up to exactly 100%, however many people share', () => {
    for (let n = 1; n <= 20; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${String(i)}`);
      const seeded = seedPercents(ids, 'en');
      const sum = ids.reduce((acc, id) => acc + parseBps(seeded[id]), 0n);
      expect(sum).toBe(BPS_TOTAL);
    }
  });
  it('spreads the indivisible remainder over the first people', () => {
    const seeded = seedPercents(['a', 'b', 'c'], 'en');
    expect([seeded.a, seeded.b, seeded.c]).toEqual(['33.34', '33.33', '33.33']);
  });
  it('has nothing to seed for an empty split', () => {
    expect(seedPercents([], 'en')).toEqual({});
  });
});
