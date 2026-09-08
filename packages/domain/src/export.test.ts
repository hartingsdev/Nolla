import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type Entry, type ParticipantId, CSV_BOM, csvDialect, currency, entryFromWire, exportFilename,
  formatPrecise, localDate, money, precise, preciseFromString, tripCsv,
} from './index';
import { arbLedger } from './testing/gen';

const EUR = currency('EUR');
const JPY = currency('JPY');
const pid = (s: string) => s as ParticipantId;
const people = [{ id: 'y', name: 'Yannik' }, { id: 'm', name: 'Max' }, { id: 'r', name: 'Robert' }];

/** €55.18 split three ways — the case that made us pick 8-digit shares (D8). */
const dinner: Entry = entryFromWire({
  id: 'e1', type: 'expense', description: 'Dinner', category: 'food', amount: '55.18', ccy: 'EUR',
  date: '2026-03-06', createdAt: '2026-03-06T19:00:00.000Z',
  payments: [{ participantId: 'y', amount: '55.18' }],
  shares: [
    { participantId: 'y', amount: '18.39333333' },
    { participantId: 'm', amount: '18.39333333' },
    { participantId: 'r', amount: '18.39333334' },
  ],
});

const base = { tripName: 'Ski 2026', status: 'Open', ccy: EUR, participants: people, generatedAt: '2026-09-08T10:00:00.000Z' };
const rowsOf = (csv: string) => csv.split('\r\n').map((r) => r.split(','));

describe('tripCsv', () => {
  it('lays out one row per entry and one column per participant', () => {
    const rows = rowsOf(tripCsv({ ...base, entries: [dinner] }));
    const header = rows.find((r) => r[0] === 'Date');
    expect(header).toEqual(['Date', 'Type', 'Description', 'Category', 'Amount', 'Paid by', 'Yannik', 'Max', 'Robert', 'Settled']);
    const entry = rows[rows.indexOf(header as string[]) + 1] as string[];
    expect(entry.slice(0, 6)).toEqual(['2026-03-06', 'Expense', 'Dinner', 'food', '55.18', 'Yannik (55.18)']);
    expect(entry.slice(6, 9)).toEqual(['18.39333333', '18.39333333', '18.39333334']);
  });

  it('keeps sub-cent precision in shares but prints payable amounts as cents', () => {
    const csv = tripCsv({ ...base, entries: [dinner] });
    expect(csv).toContain('18.39333333');
    expect(csv).toContain('55.18');
  });

  it('trims trailing zeros down to the currency precision, and no further', () => {
    expect(formatPrecise(preciseFromString('12.50000000', EUR), { delimiter: ',', decimal: '.' })).toBe('12.50');
    expect(formatPrecise(preciseFromString('12.00000000', EUR), { delimiter: ',', decimal: '.' })).toBe('12.00');
    expect(formatPrecise(preciseFromString('12.50500000', EUR), { delimiter: ',', decimal: '.' })).toBe('12.505');
    // A currency without minor units keeps no decimal point at all.
    expect(formatPrecise(precise(1200000000n, JPY), { delimiter: ',', decimal: '.' })).toBe('12');
  });

  it('totals: paid and owed both add up to the trip cost, and balances sum to zero', () => {
    const rows = rowsOf(tripCsv({ ...base, entries: [dinner] }));
    const total = rows.find((r) => r[0] === 'Total') as string[];
    expect(total.slice(1, 5)).toEqual(['55.18', '55.18', '0.00', '0.00']);
  });

  it('separates the transfer column from the expense side', () => {
    const repay: Entry = entryFromWire({
      id: 'e2', type: 'transfer', description: 'Repayment', amount: '18.39', ccy: 'EUR',
      date: '2026-03-07', createdAt: '2026-03-07T09:00:00.000Z',
      payments: [{ participantId: 'm', amount: '18.39' }],
      shares: [{ participantId: 'y', amount: '18.39000000' }],
    });
    const rows = rowsOf(tripCsv({ ...base, entries: [dinner, repay] }));
    const max = rows.find((r) => r[0] === 'Max') as string[];
    // Max paid nothing towards expenses, owes his share, and has moved 18.39 by transfer.
    expect(max.slice(1, 5)).toEqual(['0.00', '18.39333333', '18.39', '-0.00333333']);
  });

  it('omits deleted entries and orders the rest chronologically', () => {
    const later = { ...dinner, id: 'e3', date: localDate('2026-03-09'), description: 'Later' };
    const gone = { ...dinner, id: 'e4', description: 'Gone', deleted: true };
    const csv = tripCsv({ ...base, entries: [later, gone, dinner] });
    expect(csv).not.toContain('Gone');
    expect(csv.indexOf('Dinner')).toBeLessThan(csv.indexOf('Later'));
  });

  it('appends the settlement plan when one is given', () => {
    const plan = {
      kind: 'optimal' as const, minimal: true,
      transfers: [{ from: pid('m'), to: pid('y'), amount: money(1839n, EUR) }],
      balances: new Map<ParticipantId, ReturnType<typeof money>>(),
      rounding: new Map(),
    };
    const rows = rowsOf(tripCsv({ ...base, entries: [dinner], plan }));
    expect(rows.some((r) => r[0] === 'Settlement')).toBe(true);
    expect(rows.some((r) => r[0] === 'Max' && r[1] === 'Yannik' && r[2] === '18.39')).toBe(true);
  });

  it('uses semicolons and decimal commas for German, so Excel reads the numbers', () => {
    const csv = tripCsv({ ...base, entries: [dinner], dialect: csvDialect('de-DE') });
    expect(csv).toContain('55,18');
    expect(csv).toContain(';');
    // The decimal comma must not be mistaken for a field separator.
    expect(csv.split('\r\n').find((r) => r.startsWith('2026-03-06'))?.split(';')).toHaveLength(10);
  });

  it('neutralises text a spreadsheet would run as a formula, without touching amounts', () => {
    const evil = { ...dinner, description: '=1+1' };
    const csv = tripCsv({ ...base, entries: [evil] });
    expect(csv).toContain("'=1+1");
    const negative = entryFromWire({
      id: 'e5', type: 'expense', description: 'Refund', amount: '-10.00', ccy: 'EUR',
      date: '2026-03-08', createdAt: '2026-03-08T09:00:00.000Z',
      payments: [{ participantId: 'y', amount: '-10.00' }],
      shares: [{ participantId: 'y', amount: '-10.00000000' }],
    });
    expect(tripCsv({ ...base, entries: [negative] })).toContain(',-10.00,');
  });

  it('quotes anything carrying the delimiter, a quote or a newline', () => {
    const odd = { ...dinner, description: 'Bar "Zum Löwen", Wien\nlate' };
    const csv = tripCsv({ ...base, entries: [odd] });
    expect(csv).toContain('"Bar ""Zum Löwen"", Wien\nlate"');
  });

  it('every row has the same number of fields, for any random ledger', () => {
    fc.assert(fc.property(arbLedger(EUR), ({ ids, entries }) => {
      const csv = tripCsv({
        ...base, ccy: EUR,
        participants: ids.map((id) => ({ id, name: `P-${id}` })),
        entries: entries.map((e, i) => ({ ...e, description: `entry ${i}`, createdAt: `2026-03-0${(i % 9) + 1}T00:00:00.000Z` })),
      });
      const widths = new Set(parseCsv(csv).map((r) => r.length));
      expect(widths.size).toBe(1);
    }), { numRuns: 100 });
  });
});

describe('exportFilename', () => {
  it('slugs the trip name and stamps the day', () => {
    expect(exportFilename('Ski 2026 — Österreich', '2026-09-08T10:00:00.000Z')).toBe('ski-2026-o-sterreich-2026-09-08.csv');
    expect(exportFilename('  ', '2026-09-08T10:00:00.000Z')).toBe('trip-2026-09-08.csv');
  });
});

describe('CSV_BOM', () => {
  it('is the UTF-8 byte-order mark Excel needs to detect the encoding', () => {
    expect(CSV_BOM.codePointAt(0)).toBe(0xfeff);
  });
});

/** Minimal RFC 4180 reader, so the width property is checked against a real parse. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [[]];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { (rows[rows.length - 1] as string[]).push(field); field = ''; continue; }
    if (c === '\r' && text[i + 1] === '\n') { (rows[rows.length - 1] as string[]).push(field); field = ''; rows.push([]); i++; continue; }
    field += c;
  }
  (rows[rows.length - 1] as string[]).push(field);
  return rows;
}
