import { describe, expect, it } from 'vitest';
import { type WireEntry, entryDiff, isEmptyDiff } from './index';

const base: WireEntry = {
  id: 'e1', type: 'expense', description: 'Dinner', amount: '55.18', ccy: 'EUR', date: '2026-03-06',
  category: 'restaurant', createdAt: '2026-03-06T19:00:00.000Z',
  payments: [{ participantId: 'y', amount: '55.18' }],
  shares: [
    { participantId: 'y', amount: '18.39333333' },
    { participantId: 'm', amount: '18.39333333' },
    { participantId: 'r', amount: '18.39333334' },
  ],
};

describe('entryDiff', () => {
  it('finds nothing between an entry and itself', () => {
    expect(isEmptyDiff(entryDiff(base, base))).toBe(true);
  });

  it('reports scalar fields in reading order, with both sides', () => {
    const after: WireEntry = { ...base, description: 'Dinner at Casamore', amount: '60.18', date: '2026-03-07' };
    expect(entryDiff(base, after).fields).toEqual([
      { field: 'description', from: 'Dinner', to: 'Dinner at Casamore' },
      { field: 'amount', from: '55.18', to: '60.18' },
      { field: 'date', from: '2026-03-06', to: '2026-03-07' },
    ]);
  });

  it('treats an absent category or reason as empty rather than missing', () => {
    const { category: _c, ...without } = base;
    expect(entryDiff(without as WireEntry, base).fields).toEqual([{ field: 'category', from: '', to: 'restaurant' }]);
    expect(entryDiff(base, without as WireEntry).fields).toEqual([{ field: 'category', from: 'restaurant', to: '' }]);
  });

  it('reads a delete and a restore off the same field', () => {
    const deleted: WireEntry = { ...base, deleted: true };
    expect(entryDiff(base, deleted).fields).toEqual([{ field: 'deleted', from: 'false', to: 'true' }]);
    expect(entryDiff(deleted, base).fields).toEqual([{ field: 'deleted', from: 'true', to: 'false' }]);
  });

  it('reports a changed share with both amounts, and leaves untouched ones out', () => {
    const after: WireEntry = {
      ...base,
      shares: [
        { participantId: 'y', amount: '27.59000000' },
        { participantId: 'm', amount: '18.39333333' },
        { participantId: 'r', amount: '9.19666667' },
      ],
    };
    expect(entryDiff(base, after).shares).toEqual([
      { participantId: 'y', from: '18.39333333', to: '27.59000000' },
      { participantId: 'r', from: '18.39333334', to: '9.19666667' },
    ]);
  });

  it('marks someone joining the split with a null before, and leaving with a null after', () => {
    const after: WireEntry = {
      ...base,
      shares: [
        { participantId: 'y', amount: '27.59000000' },
        { participantId: 'm', amount: '27.59000000' },
      ],
    };
    const d = entryDiff(base, after);
    expect(d.shares).toContainEqual({ participantId: 'r', from: '18.39333334', to: null });
    const joined = entryDiff(after, base);
    expect(joined.shares).toContainEqual({ participantId: 'r', from: null, to: '18.39333334' });
  });

  it('reports a change of payer on both sides', () => {
    const after: WireEntry = { ...base, payments: [{ participantId: 'm', amount: '55.18' }] };
    expect(entryDiff(base, after).payments).toEqual([
      { participantId: 'm', from: null, to: '55.18' },
      { participantId: 'y', from: '55.18', to: null },
    ]);
  });

  it('sees a split of one payment into two', () => {
    const after: WireEntry = {
      ...base,
      payments: [{ participantId: 'y', amount: '30.00' }, { participantId: 'm', amount: '25.18' }],
    };
    expect(entryDiff(base, after).payments).toEqual([
      { participantId: 'y', from: '55.18', to: '30.00' },
      { participantId: 'm', from: null, to: '25.18' },
    ]);
  });

  it('ignores fields only the server sets, so a re-save with no edit reads as no change', () => {
    // createdAt and ccy travel with the entry but are not editable; a snapshot
    // differing only in those is not something to report.
    const resaved: WireEntry = { ...base, createdAt: '2026-03-06T19:00:01.000Z' };
    expect(isEmptyDiff(entryDiff(base, resaved))).toBe(true);
  });
});
