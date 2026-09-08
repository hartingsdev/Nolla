/**
 * Spreadsheet-shaped CSV export (FR-7.8) — the exit path back to a sheet, and
 * the safety valve if the group ever abandons the app mid-trip (§13).
 *
 * Pure like the rest of the domain: no clock, no file system, no i18n. The
 * caller supplies the timestamp, the translated labels and the CSV dialect;
 * this module only turns a trip into text.
 *
 * The layout mirrors the sheet it replaces: one row per entry, one column per
 * participant holding that person's share, then the `Gesamt` / `Bereits
 * gezahlt` / `Offen` block (FR-7.1, FR-7.3) and the settlement plan.
 */

import { type Currency, type Money, type Precise, M, P, moneyToString, preciseToString, toPrecise, zeroMoney, zeroPrecise } from './money';
import { type LedgerEntry, participantTotals } from './ledger';
import { type Plan } from './settlement';
import { type ParticipantId } from './split';
import { type Entry } from './wire';

export interface CsvDialect {
  /** `,` for en, `;` for locales where the decimal separator is a comma. */
  readonly delimiter: ',' | ';';
  readonly decimal: '.' | ',';
}

/** Excel on a German locale reads `,` as the decimal point, so the field separator has to move. */
export function csvDialect(locale: string): CsvDialect {
  return locale.startsWith('de') ? { delimiter: ';', decimal: ',' } : { delimiter: ',', decimal: '.' };
}

/** Every string the export prints that is not trip data. Supplied translated (D10). */
export interface ExportLabels {
  readonly trip: string;
  readonly currency: string;
  readonly status: string;
  readonly exported: string;
  readonly date: string;
  readonly type: string;
  readonly description: string;
  readonly reason: string;
  readonly category: string;
  readonly amount: string;
  readonly paidBy: string;
  readonly settled: string;
  readonly entries: string;
  readonly totals: string;
  readonly participant: string;
  readonly paid: string;
  readonly owed: string;
  readonly transfers: string;
  readonly balance: string;
  readonly total: string;
  readonly settlement: string;
  readonly from: string;
  readonly to: string;
  readonly types: Readonly<Record<LedgerEntry['type'], string>>;
}

export const defaultExportLabels: ExportLabels = {
  trip: 'Trip', currency: 'Currency', status: 'Status', exported: 'Exported',
  date: 'Date', type: 'Type', description: 'Description', reason: 'Reason', category: 'Category',
  amount: 'Amount', paidBy: 'Paid by', settled: 'Settled',
  entries: 'Entries', totals: 'Totals', participant: 'Participant',
  paid: 'Paid', owed: 'Owed', transfers: 'Transfers', balance: 'Balance', total: 'Total',
  settlement: 'Settlement', from: 'From', to: 'To',
  types: { expense: 'Expense', transfer: 'Transfer', adjustment: 'Adjustment' },
};

export interface ExportParticipant { readonly id: string; readonly name: string }

export interface TripExport {
  readonly tripName: string;
  /** Already-translated lifecycle status ("Open", "Offen", …). */
  readonly status: string;
  readonly ccy: Currency;
  readonly participants: readonly ExportParticipant[];
  readonly entries: readonly Entry[];
  /** Omitted when nothing is left to settle. */
  readonly plan?: Plan;
  /** ISO-8601 instant from the caller's Clock — the domain never reads the time itself. */
  readonly generatedAt: string;
  readonly labels?: ExportLabels;
  readonly dialect?: CsvDialect;
}

// ---------------------------------------------------------------------------
// Cell formatting
// ---------------------------------------------------------------------------

/** Trailing zeros beyond the currency's own precision are noise; what is left is exact (P6). */
function trimScale(s: string, minFrac: number): string {
  if (!s.includes('.')) return s;
  const [int = '', frac = ''] = s.split('.');
  let end = frac.length;
  while (end > minFrac && frac[end - 1] === '0') end -= 1;
  return end === 0 ? int : `${int}.${frac.slice(0, end)}`;
}

const withDecimal = (s: string, d: CsvDialect): string => (d.decimal === ',' ? s.replace('.', ',') : s);

export function formatMoney(m: Money, d: CsvDialect): string {
  return withDecimal(moneyToString(m), d);
}

/**
 * A share can carry more precision than the currency has cents (D8): print what
 * is there rather than rounding, so the export and the ledger always agree.
 */
export function formatPrecise(p: Precise, d: CsvDialect): string {
  return withDecimal(trimScale(preciseToString(p), p.ccy.exponent), d);
}

/**
 * Spreadsheets treat a leading `=`, `+`, `-` or `@` in a text cell as a formula,
 * so free text gets a leading apostrophe. Numeric cells are built by this module
 * and never go through here, so negative amounts stay numbers.
 */
function safeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function cell(value: string, d: CsvDialect): string {
  return /["\r\n]/.test(value) || value.includes(d.delimiter) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

const live = (entries: readonly Entry[]): Entry[] =>
  entries.filter((e) => !e.deleted).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

export function tripCsv(input: TripExport): string {
  const labels = input.labels ?? defaultExportLabels;
  const d = input.dialect ?? { delimiter: ',', decimal: '.' };
  const ccy = input.ccy;
  const entries = live(input.entries);
  const people = input.participants;
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const rows: string[][] = [];

  // Header block — what this file is, so a printed copy still identifies itself.
  rows.push([labels.trip, safeText(input.tripName)]);
  rows.push([labels.currency, ccy.code]);
  rows.push([labels.status, safeText(input.status)]);
  rows.push([labels.exported, input.generatedAt]);
  rows.push([]);

  // Entries: one row per entry, one column per participant (the sheet's shape).
  rows.push([labels.entries]);
  rows.push([labels.date, labels.type, labels.description, labels.reason, labels.category, labels.amount, labels.paidBy, ...people.map((p) => safeText(p.name)), labels.settled]);
  for (const e of entries) {
    const shareOf = new Map(e.shares.map((s) => [s.participantId as string, s.amount]));
    const paidBy = e.payments.map((p) => `${nameOf.get(p.participantId) ?? p.participantId} (${formatMoney(p.amount, d)})`).join(' + ');
    const settled = Object.keys(e.settled ?? {}).map((id) => nameOf.get(id) ?? id).join(' + ');
    rows.push([
      e.date,
      labels.types[e.type],
      safeText(e.description),
      safeText(e.reason ?? ''),   // mandatory on an adjustment (FR-6.1), absent everywhere else
      safeText(e.category ?? ''),
      formatMoney(e.amount, d),
      safeText(paidBy),
      ...people.map((p) => { const s = shareOf.get(p.id); return s ? formatPrecise(s, d) : ''; }),
      safeText(settled),
    ]);
  }
  rows.push([]);

  // Totals (FR-7.1, FR-7.3): paid vs owed vs what transfers already moved.
  const totals = participantTotals(entries, ccy);
  rows.push([labels.totals]);
  rows.push([labels.participant, labels.paid, labels.owed, labels.transfers, labels.balance]);
  let paidSum = zeroMoney(ccy);
  let owedSum = zeroPrecise(ccy);
  for (const p of people) {
    const t = totals.get(p.id as ParticipantId) ?? { paid: zeroMoney(ccy), owed: zeroPrecise(ccy), balance: zeroPrecise(ccy) };
    // Balance minus the expense side is exactly what transfers and adjustments moved.
    const moved = P.sub(t.balance, P.sub(toPrecise(t.paid), t.owed));
    paidSum = M.add(paidSum, t.paid);
    owedSum = P.add(owedSum, t.owed);
    rows.push([safeText(p.name), formatMoney(t.paid, d), formatPrecise(t.owed, d), formatPrecise(moved, d), formatPrecise(t.balance, d)]);
  }
  // Both totals equal the trip cost and the balance column sums to zero (I2, I4).
  rows.push([labels.total, formatMoney(paidSum, d), formatPrecise(owedSum, d), formatPrecise(zeroPrecise(ccy), d), formatPrecise(zeroPrecise(ccy), d)]);

  // Settlement plan, when one is still outstanding.
  if (input.plan && input.plan.transfers.length > 0) {
    rows.push([]);
    rows.push([labels.settlement]);
    rows.push([labels.from, labels.to, labels.amount]);
    for (const tr of input.plan.transfers) {
      rows.push([safeText(nameOf.get(tr.from) ?? tr.from), safeText(nameOf.get(tr.to) ?? tr.to), formatMoney(tr.amount, d)]);
    }
  }

  // Pad every row to the widest, so spreadsheets show one clean grid.
  const width = rows.reduce((w, r) => (r.length > w ? r.length : w), 0);
  return rows
    .map((r) => [...r, ...new Array<string>(width - r.length).fill('')].map((c) => cell(c, d)).join(d.delimiter))
    .join('\r\n');
}

/** Excel only detects UTF-8 in a CSV when the byte-order mark is there. */
export const CSV_BOM = '﻿';

/** `vacation-2026-09-08.csv` — slugged trip name, calendar day of the export. */
export function exportFilename(tripName: string, generatedAt: string): string {
  const slug = tripName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const day = generatedAt.slice(0, 10);
  return `${slug || 'trip'}-${day}.csv`;
}
