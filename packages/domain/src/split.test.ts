import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type ParticipantId, type SplitRule, BPS_TOTAL, DomainError, M, P, allocate, currency,
  exactResidual, money, precise, preciseToString, roundAll, toPrecise,
} from './index';

const EUR = currency('EUR');
const JPY = currency('JPY');
const BHD = currency('BHD');
const pid = (s: string): ParticipantId => s as ParticipantId;
const [Y, MX, R, T, MC] = ['yannik', 'max', 'robert', 'tobias', 'marc'].map(pid) as [ParticipantId, ParticipantId, ParticipantId, ParticipantId, ParticipantId];

const arbCcy = fc.constantFrom(EUR, JPY, BHD);
const arbIds = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 12 }).map((xs) => xs.map(pid));
const arbTotal = (ccy: ReturnType<typeof currency>) => fc.bigInt({ min: -5_000_000n, max: 5_000_000n }).map((m) => money(m, ccy));

const arbRule = (ids: ParticipantId[]): fc.Arbitrary<SplitRule> => fc.oneof(
  fc.constant<SplitRule>({ kind: 'equal', among: ids }),
  fc.array(fc.bigInt({ min: 0n, max: 20n }), { minLength: ids.length, maxLength: ids.length })
    .filter((ws) => ws.some((w) => w > 0n))
    .map((ws) => ({ kind: 'weights', weights: Object.fromEntries(ids.map((id, i) => [id, ws[i]])) }) as SplitRule),
  // percentages: random cut points of 10 000 bps
  fc.array(fc.bigInt({ min: 0n, max: BPS_TOTAL }), { minLength: ids.length - 1, maxLength: ids.length - 1 })
    .map((cuts) => {
      const sorted = [...cuts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const parts: bigint[] = []; let prev = 0n;
      for (const c of sorted) { parts.push(c - prev); prev = c; }
      parts.push(BPS_TOTAL - prev);
      return { kind: 'percent', bps: Object.fromEntries(ids.map((id, i) => [id, parts[i]])) } as SplitRule;
    }),
);

describe('allocate — invariant I1', () => {
  it('shares always sum exactly to the total, for every rule kind and currency', () => {
    fc.assert(fc.property(
      arbCcy.chain((ccy) => fc.tuple(fc.constant(ccy), arbTotal(ccy), arbIds)).chain(([ccy, total, ids]) =>
        fc.tuple(fc.constant(ccy), fc.constant(total), arbRule(ids), fc.string())),
      ([ccy, total, rule, seed]) => {
        const shares = allocate(total, rule, { seed });
        expect(P.eq(P.sum(shares.map((s) => s.amount), ccy), toPrecise(total))).toBe(true);
      },
    ), { numRuns: 500 });
  });

  it('equal splits differ by at most one 10⁻⁸ unit between participants (P5)', () => {
    fc.assert(fc.property(arbCcy.chain((ccy) => fc.tuple(arbTotal(ccy), arbIds, fc.string())), ([total, ids, seed]) => {
      const shares = allocate(total, { kind: 'equal', among: ids }, { seed });
      const amounts = shares.map((s) => s.amount.scaled);
      const max = amounts.reduce((a, b) => (a > b ? a : b));
      const min = amounts.reduce((a, b) => (a < b ? a : b));
      expect(max - min <= 1n).toBe(true);
    }));
  });

  it('a weighted split is proportional to within one unit', () => {
    const shares = allocate(money(10000n, EUR), { kind: 'weights', weights: { [Y]: 2n, [MX]: 1n, [R]: 1n } }, { seed: 's' });
    const by = Object.fromEntries(shares.map((s) => [s.participantId, preciseToString(s.amount)]));
    expect(by).toEqual({ [Y]: '50.00000000', [MX]: '25.00000000', [R]: '25.00000000' });
  });

  it('surcharges (tips) are added on top and the total still reconciles (FR-3.7)', () => {
    // €40 bill + €2 tip from Yannik + €3 tip from Max = €45 entry total, base split equally 4 ways
    const shares = allocate(money(4500n, EUR), { kind: 'equal', among: [Y, MX, R, T] }, {
      seed: 's', surcharges: [{ participantId: Y, amount: money(200n, EUR) }, { participantId: MX, amount: money(300n, EUR) }],
    });
    const by = Object.fromEntries(shares.map((s) => [s.participantId, preciseToString(s.amount)]));
    expect(by).toEqual({ [Y]: '12.00000000', [MX]: '13.00000000', [R]: '10.00000000', [T]: '10.00000000' });
  });

  it('rejects invalid rules', () => {
    expect(() => allocate(money(100n, EUR), { kind: 'equal', among: [] }, { seed: 's' })).toThrow(DomainError);
    expect(() => allocate(money(100n, EUR), { kind: 'equal', among: [Y, Y] }, { seed: 's' })).toThrow(DomainError);
    expect(() => allocate(money(100n, EUR), { kind: 'weights', weights: { [Y]: 0n } }, { seed: 's' })).toThrow(DomainError);
    expect(() => allocate(money(100n, EUR), { kind: 'weights', weights: { [Y]: -1n, [MX]: 2n } }, { seed: 's' })).toThrow(DomainError);
    expect(() => allocate(money(100n, EUR), { kind: 'percent', bps: { [Y]: 5000n, [MX]: 4000n } }, { seed: 's' })).toThrow(DomainError);
  });
});

describe('the sheet cases', () => {
  it('€55.18 / 5 is stored as five shares of exactly 11.036 and displays as 11.04 ×3 + 11.03 ×2 (FR-3.6 acceptance)', () => {
    const total = money(5518n, EUR);
    const shares = allocate(total, { kind: 'equal', among: [Y, MX, R, T, MC] }, { seed: 'einkauf-krefeld' });
    expect(shares.map((s) => preciseToString(s.amount))).toEqual(Array<string>(5).fill('11.03600000'));
    const shown = roundAll(shares.map((s) => s.amount), total, 'einkauf-krefeld');
    expect(shown.map((m) => m.minor).sort()).toEqual([1103n, 1103n, 1104n, 1104n, 1104n]);
    expect(M.sum(shown, EUR).minor).toBe(5518n);
  });

  it('Rulantica: €168 among 4 of 5 → €42 each, Marc excluded', () => {
    const shares = allocate(money(16800n, EUR), { kind: 'equal', among: [Y, MX, R, T] }, { seed: 'rulantica' });
    expect(shares.map((s) => preciseToString(s.amount))).toEqual(Array<string>(4).fill('42.00000000'));
    expect(shares.some((s) => s.participantId === MC)).toBe(false);
  });

  it('Casamore as typed in the sheet (119.97 vs 120.00) is rejected with the residual, so the UI can offer to assign it', () => {
    const amounts = { [Y]: money(2945n, EUR), [R]: money(3245n, EUR), [T]: money(3612n, EUR), [MC]: money(2195n, EUR) };
    expect(() => allocate(money(12000n, EUR), { kind: 'exact', amounts }, { seed: 'casamore' })).toThrow(DomainError);
    expect(exactResidual(money(12000n, EUR), Object.values(amounts)).minor).toBe(3n);
    // fixed by the UI: assign the 3 ct to Marc
    const fixed = { ...amounts, [MC]: money(2198n, EUR) };
    const shares = allocate(money(12000n, EUR), { kind: 'exact', amounts: fixed }, { seed: 'casamore' });
    expect(P.sum(shares.map((s) => s.amount), EUR).scaled).toBe(toPrecise(money(12000n, EUR)).scaled);
  });

  it('Pfandsammlung: a negative total splits into negative shares', () => {
    const shares = allocate(money(-875n, EUR), { kind: 'equal', among: [Y, MX, R, T, MC] }, { seed: 'pfand' });
    expect(shares.map((s) => preciseToString(s.amount))).toEqual(Array<string>(5).fill('-1.75000000'));
  });

  it('ten identical €55.18 splits leave everyone at exactly 110.36 with zero spread (D8)', () => {
    const per = Array.from({ length: 5 }, () => precise(0n, EUR));
    for (let k = 0; k < 10; k++) {
      allocate(money(5518n, EUR), { kind: 'equal', among: [Y, MX, R, T, MC] }, { seed: `e${String(k)}` })
        .forEach((s, i) => { per[i] = P.add(per[i]!, s.amount); });
    }
    const shown = roundAll(per, money(55180n, EUR), 'final');
    expect(shown.map((m) => m.minor)).toEqual([11036n, 11036n, 11036n, 11036n, 11036n]);
  });
});
