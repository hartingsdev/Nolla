import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type Entry, type Money, type ParticipantId, type SplitRule, type Surcharge,
  allocate, currency, entryFromWire, entryToWire, localDate, money, preciseToString,
} from './index';
import { arbLedger } from './testing/gen';

describe('wire codec (P6)', () => {
  it('carries category and per-share settlement links', () => {
    const EUR = currency('EUR');
    const e = {
      id: 'e', type: 'expense' as const, description: 'd', createdAt: 't', category: 'groceries',
      amount: { kind: 'money' as const, minor: 100n, ccy: EUR }, date: '2026-07-01' as never,
      payments: [{ participantId: 'a' as never, amount: { kind: 'money' as const, minor: 100n, ccy: EUR } }],
      shares: [{ participantId: 'a' as never, amount: { kind: 'precise' as const, scaled: 50n * 10n ** 6n, ccy: EUR } }, { participantId: 'b' as never, amount: { kind: 'precise' as const, scaled: 50n * 10n ** 6n, ccy: EUR } }],
      settled: { b: 'transfer-1' },
    };
    const w = entryToWire(e);
    expect(w.category).toBe('groceries');
    expect(w.shares[1]?.settledBy).toBe('transfer-1');
    expect(entryFromWire(w)).toEqual(e);
  });

  it('round-trips every generated entry, and never emits a JSON number for money', () => {
    fc.assert(fc.property(arbLedger(currency('EUR'), { maxEntries: 15 }), ({ entries }) => {
      for (const e of entries) {
        const entry = { ...e, description: 'x', createdAt: '2026-07-01T10:00:00Z' };
        const wire = entryToWire(entry);
        expect(entryFromWire(wire)).toEqual(entry);
        const json = JSON.stringify(wire);
        expect(json).not.toMatch(/"amount":-?\d/);
      }
    }));
  });
});

describe('split intent (FR-3.5, FR-3.7)', () => {
  const EUR2 = currency('EUR');
  const ids = ['a', 'b', 'c'] as ParticipantId[];

  /** The point of storing the rule: re-applying it reproduces the very same shares. */
  const reproduces = (amount: Money, rule: SplitRule, surcharges: Surcharge[] = []) => {
    const shares = allocate(amount, rule, { seed: 'e1', surcharges });
    const entry: Entry = {
      id: 'e1', type: 'expense', description: 'x', amount, date: localDate('2026-03-01'),
      payments: [{ participantId: ids[0]!, amount }], shares,
      split: { rule, ...(surcharges.length ? { surcharges } : {}) },
      createdAt: '2026-03-01T10:00:00.000Z',
    };
    const back = entryFromWire(entryToWire(entry));
    expect(back.split).toBeDefined();
    const again = allocate(back.amount, back.split!.rule, { seed: 'e1', surcharges: back.split!.surcharges ?? [] });
    expect(again.map((s) => preciseToString(s.amount))).toEqual(shares.map((s) => preciseToString(s.amount)));
  };

  it('round-trips an equal split', () => { reproduces(money(9000n, EUR2), { kind: 'equal', among: ids }); });

  it('round-trips weights, which no share list could reveal on its own', () => {
    reproduces(money(9000n, EUR2), { kind: 'weights', weights: { a: 2n, b: 1n, c: 1n } as Record<ParticipantId, bigint> });
  });

  it('round-trips percentages that do not divide evenly', () => {
    reproduces(money(10000n, EUR2), { kind: 'percent', bps: { a: 3334n, b: 3333n, c: 3333n } as Record<ParticipantId, bigint> });
  });

  it('round-trips exact amounts', () => {
    reproduces(money(6000n, EUR2), { kind: 'exact', amounts: { a: money(1000n, EUR2), b: money(2000n, EUR2), c: money(3000n, EUR2) } as Record<ParticipantId, Money> });
  });

  it('round-trips a tip, so reopening and re-saving cannot silently move money', () => {
    reproduces(money(12000n, EUR2), { kind: 'equal', among: ids }, ids.map((id) => ({ participantId: id, amount: money(400n, EUR2) })));
  });

  it('is optional: an entry saved before this existed still round-trips', () => {
    const amount = money(3000n, EUR2);
    const entry: Entry = {
      id: 'e2', type: 'expense', description: 'x', amount, date: localDate('2026-03-01'),
      payments: [{ participantId: ids[0]!, amount }],
      shares: allocate(amount, { kind: 'equal', among: ids }, { seed: 'e2' }),
      createdAt: '2026-03-01T10:00:00.000Z',
    };
    const wire = entryToWire(entry);
    expect(wire.split).toBeUndefined();
    expect(entryFromWire(wire).split).toBeUndefined();
  });
});
