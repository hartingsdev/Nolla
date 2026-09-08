import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { currency, entryFromWire, entryToWire } from './index';
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
