import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type LedgerEntry, type ParticipantId, DomainError, M, P, allocate, balances, currency, grossMatrix,
  localDate, money, participantTotals, precise, tripCost, validateEntry, zeroPrecise,
} from './index';
import { arbLedger } from './testing/gen';

const EUR = currency('EUR');
const pid = (s: string) => s as ParticipantId;
const [Y, MX, R] = [pid('yannik'), pid('max'), pid('robert')];

describe('invariants over random ledgers', () => {
  it('I1: every generated entry validates', () => {
    fc.assert(fc.property(arbLedger(EUR), ({ entries }) => { entries.forEach(validateEntry); }));
  });
  it('I2: balances sum to exactly zero, for every mix of entry types', () => {
    fc.assert(fc.property(fc.constantFrom(EUR, currency('JPY'), currency('BHD')).chain((c) => arbLedger(c)), ({ ccy, entries }) => {
      const b = balances(entries, ccy);
      expect(P.sum([...b.values()], ccy).scaled).toBe(0n);
    }), { numRuns: 300 });
  });
  it('the gross matrix and balances agree: balance(a) == Σ_b D[b][a] − Σ_b D[a][b]', () => {
    fc.assert(fc.property(arbLedger(EUR), ({ ccy, ids, entries }) => {
      const b = balances(entries, ccy);
      const D = grossMatrix(entries, ccy);
      for (const a of ids) {
        let owedToA = zeroPrecise(ccy); let aOwes = zeroPrecise(ccy);
        for (const x of ids) {
          owedToA = P.add(owedToA, D.get(x)?.get(a) ?? zeroPrecise(ccy));
          aOwes = P.add(aOwes, D.get(a)?.get(x) ?? zeroPrecise(ccy));
        }
        expect(P.eq(P.sub(owedToA, aOwes), b.get(a) ?? zeroPrecise(ccy))).toBe(true);
      }
    }), { numRuns: 300 });
  });
  it('I4: trip cost counts expenses only, and deleted entries count for nothing', () => {
    fc.assert(fc.property(arbLedger(EUR), ({ ccy, entries }) => {
      const expected = entries.filter((e) => e.type === 'expense').reduce((acc, e) => acc + e.amount.minor, 0n);
      expect(tripCost(entries, ccy).minor).toBe(expected);
      const allDeleted = entries.map((e) => ({ ...e, deleted: true }));
      expect(tripCost(allDeleted, ccy).minor).toBe(0n);
      expect(balances(allDeleted, ccy).size).toBe(0);
    }));
  });
});

describe('validateEntry', () => {
  const base: LedgerEntry = {
    id: 'x', type: 'expense', amount: money(1000n, EUR), date: localDate('2026-07-01'),
    payments: [{ participantId: Y, amount: money(1000n, EUR) }],
    shares: allocate(money(1000n, EUR), { kind: 'equal', among: [Y, MX] }, { seed: 'x' }),
  };
  it('accepts a well-formed expense', () => { expect(() => { validateEntry(base); }).not.toThrow(); });
  it('rejects payments that do not sum to the amount', () => {
    expect(() => { validateEntry({ ...base, payments: [{ participantId: Y, amount: money(999n, EUR) }] }); }).toThrow(DomainError);
  });
  it('rejects shares that do not sum to the amount', () => {
    expect(() => { validateEntry({ ...base, shares: [{ participantId: Y, amount: precise(1n, EUR) }] }); }).toThrow(DomainError);
  });
  it('rejects an adjustment without a reason, accepts one with', () => {
    expect(() => { validateEntry({ ...base, type: 'adjustment' }); }).toThrow(/reason/);
    expect(() => { validateEntry({ ...base, type: 'adjustment', reason: 'Umbuchung' }); }).not.toThrow();
  });
  it('a transfer is exactly one sender, one different recipient, positive', () => {
    const t: LedgerEntry = { ...base, type: 'transfer', shares: [{ participantId: MX, amount: precise(10n * 10n ** 8n, EUR) }] };
    expect(() => { validateEntry(t); }).not.toThrow();
    expect(() => { validateEntry({ ...t, shares: [{ participantId: Y, amount: precise(10n * 10n ** 8n, EUR) }] }); }).toThrow(/oneself/);
    expect(() => { validateEntry({ ...t, amount: money(-1000n, EUR), payments: [{ participantId: Y, amount: money(-1000n, EUR) }], shares: [{ participantId: MX, amount: precise(-10n * 10n ** 8n, EUR) }] }); }).toThrow(/positive/);
  });
  it('rejects payments opposing the sign of the amount', () => {
    expect(() => { validateEntry({ ...base, payments: [{ participantId: Y, amount: money(3000n, EUR) }, { participantId: MX, amount: money(-2000n, EUR) }] }); }).toThrow(/sign/);
  });
});

describe('a real trip, in miniature', () => {
  it('Cashback Marc: a negative expense paid by Marc means Marc owes everyone their slice', () => {
    const MC = pid('marc');
    const among = [Y, MX, R, MC];
    const e: LedgerEntry = {
      id: 'cashback', type: 'expense', amount: money(-6050n, EUR), date: localDate('2026-07-01'),
      payments: [{ participantId: MC, amount: money(-6050n, EUR) }],
      shares: allocate(money(-6050n, EUR), { kind: 'equal', among }, { seed: 'cashback' }),
    };
    const D = grossMatrix([e], EUR);
    expect(D.get(MC)?.get(Y)?.scaled).toBe(15125n * 10n ** 5n); // 15.125 each
    expect(D.get(Y)?.get(MC)).toBeUndefined();
    const b = balances([e], EUR);
    expect(b.get(MC)?.scaled).toBe(-3n * 15125n * 10n ** 5n);
  });
  it('a transfer moves balance and costs the trip nothing', () => {
    const rent: LedgerEntry = {
      id: 'rent', type: 'expense', amount: money(46535n, EUR), date: localDate('2026-07-01'),
      payments: [{ participantId: R, amount: money(46535n, EUR) }],
      shares: allocate(money(46535n, EUR), { kind: 'equal', among: [Y, MX, R] }, { seed: 'rent' }),
    };
    const zahlung: LedgerEntry = {
      id: 'z', type: 'transfer', amount: money(5000n, EUR), date: localDate('2026-07-02'),
      payments: [{ participantId: Y, amount: money(5000n, EUR) }],
      shares: [{ participantId: R, amount: precise(50n * 10n ** 8n, EUR) }],
    };
    expect(tripCost([rent, zahlung], EUR).minor).toBe(46535n);
    const before = balances([rent], EUR); const after = balances([rent, zahlung], EUR);
    expect(P.sub(after.get(Y)!, before.get(Y)!).scaled).toBe(50n * 10n ** 8n);
    expect(P.sub(after.get(R)!, before.get(R)!).scaled).toBe(-50n * 10n ** 8n);
    const totals = participantTotals([rent, zahlung], EUR);
    expect(M.eq(totals.get(R)!.paid, money(46535n, EUR))).toBe(true);
    expect(M.eq(totals.get(Y)!.paid, money(0n, EUR))).toBe(true); // a transfer is not "paid" spend
  });
});
