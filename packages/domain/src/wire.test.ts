import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { currency, entryFromWire, entryToWire } from './index';
import { arbLedger } from './testing/gen';

describe('wire codec (P6)', () => {
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
