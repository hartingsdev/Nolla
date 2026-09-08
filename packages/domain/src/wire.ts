/**
 * Wire / storage form of ledger data: every money value is a decimal string
 * (P6). Used by the client's local store now and by the API contracts later.
 */
import { type LedgerEntry, type Payment } from './ledger';
import { type Currency, currency, moneyFromString, moneyToString, preciseFromString, preciseToString } from './money';
import { type ParticipantId, type Share } from './split';
import { localDate } from './ports';

export interface WirePayment { readonly participantId: string; readonly amount: string }
export interface WireShare { readonly participantId: string; readonly amount: string }
export interface WireEntry {
  readonly id: string;
  readonly type: LedgerEntry['type'];
  readonly description: string;
  readonly amount: string;
  readonly ccy: string;
  readonly date: string;
  readonly payments: readonly WirePayment[];
  readonly shares: readonly WireShare[];
  readonly reason?: string;
  readonly createdAt: string;
  readonly deleted?: boolean;
}

/** A ledger entry as the client holds it: the domain shape plus display fields. */
export interface Entry extends LedgerEntry {
  readonly description: string;
  readonly createdAt: string;
}

export function entryToWire(e: Entry): WireEntry {
  return {
    id: e.id, type: e.type, description: e.description,
    amount: moneyToString(e.amount), ccy: e.amount.ccy.code, date: e.date,
    payments: e.payments.map((p) => ({ participantId: p.participantId, amount: moneyToString(p.amount) })),
    shares: e.shares.map((s) => ({ participantId: s.participantId, amount: preciseToString(s.amount) })),
    ...(e.reason !== undefined ? { reason: e.reason } : {}),
    createdAt: e.createdAt,
    ...(e.deleted ? { deleted: true } : {}),
  };
}

export function entryFromWire(w: WireEntry): Entry {
  const ccy: Currency = currency(w.ccy);
  const payments: Payment[] = w.payments.map((p) => ({ participantId: p.participantId as ParticipantId, amount: moneyFromString(p.amount, ccy) }));
  const shares: Share[] = w.shares.map((s) => ({ participantId: s.participantId as ParticipantId, amount: preciseFromString(s.amount, ccy) }));
  return {
    id: w.id, type: w.type, description: w.description,
    amount: moneyFromString(w.amount, ccy), date: localDate(w.date),
    payments, shares,
    ...(w.reason !== undefined ? { reason: w.reason } : {}),
    createdAt: w.createdAt,
    ...(w.deleted ? { deleted: true } : {}),
  };
}
