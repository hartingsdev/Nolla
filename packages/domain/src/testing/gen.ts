import fc from 'fast-check';
import { type Currency, money } from '../money';
import { type LedgerEntry, type Payment } from '../ledger';
import { type ParticipantId, type SplitRule, allocate, BPS_TOTAL } from '../split';
import { localDate } from '../ports';

const pid = (s: string) => s as ParticipantId;

export interface GenLedger { readonly ccy: Currency; readonly ids: ParticipantId[]; readonly entries: LedgerEntry[] }

const arbAmount = fc.bigInt({ min: -200_000n, max: 200_000n });

function arbRule(ids: ParticipantId[]): fc.Arbitrary<SplitRule> {
  return fc.subarray(ids, { minLength: 1 }).chain((among) => fc.oneof(
    fc.constant<SplitRule>({ kind: 'equal', among }),
    fc.array(fc.bigInt({ min: 0n, max: 9n }), { minLength: among.length, maxLength: among.length })
      .filter((ws) => ws.some((w) => w > 0n))
      .map<SplitRule>((ws) => ({ kind: 'weights', weights: Object.fromEntries(among.map((id, i) => [id, ws[i] ?? 0n])) })),
    fc.array(fc.bigInt({ min: 0n, max: BPS_TOTAL }), { minLength: Math.max(0, among.length - 1), maxLength: Math.max(0, among.length - 1) })
      .map<SplitRule>((cuts) => {
        const sorted = [...cuts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const parts: bigint[] = []; let prev = 0n;
        for (const c of sorted) { parts.push(c - prev); prev = c; }
        parts.push(BPS_TOTAL - prev);
        return { kind: 'percent', bps: Object.fromEntries(among.map((id, i) => [id, parts[i] ?? 0n])) };
      }),
  ));
}

/** Payments summing exactly to `total`, all with its sign, over 1–2 payers. */
function arbPayments(ids: ParticipantId[], total: bigint, ccy: Currency): fc.Arbitrary<Payment[]> {
  return fc.subarray(ids, { minLength: 1, maxLength: 2 }).chain((payers) => {
    if (payers.length === 1 || total === 0n) return fc.constant([{ participantId: payers[0]!, amount: money(total, ccy) }]);
    const abs = total < 0n ? -total : total; const sign = total < 0n ? -1n : 1n;
    return fc.bigInt({ min: 0n, max: abs }).map((first) => [
      { participantId: payers[0]!, amount: money(first * sign, ccy) },
      { participantId: payers[1]!, amount: money((abs - first) * sign, ccy) },
    ]);
  });
}

export function arbLedger(ccy: Currency, opts: { maxParticipants?: number; maxEntries?: number } = {}): fc.Arbitrary<GenLedger> {
  const maxP = opts.maxParticipants ?? 8;
  const maxE = opts.maxEntries ?? 40;
  return fc.integer({ min: 2, max: maxP }).chain((n) => {
    const ids = Array.from({ length: n }, (_, i) => pid(`p${String(i).padStart(2, '0')}`));
    const arbEntry = (k: number): fc.Arbitrary<LedgerEntry> => fc.oneof(
      { weight: 6, arbitrary: fc.tuple(arbAmount, arbRule(ids)).chain(([amt, rule]) => arbPayments(ids, amt, ccy).map((payments) => ({
        id: `e${String(k)}`, type: 'expense' as const, amount: money(amt, ccy), date: localDate('2026-07-01'), payments,
        shares: allocate(money(amt, ccy), rule, { seed: `e${String(k)}` }),
      }))) },
      { weight: 2, arbitrary: fc.tuple(fc.constantFrom(...ids), fc.constantFrom(...ids), fc.bigInt({ min: 1n, max: 100_000n }))
        .filter(([a, b]) => a !== b)
        .map(([from, to, amt]) => ({
          id: `t${String(k)}`, type: 'transfer' as const, amount: money(amt, ccy), date: localDate('2026-07-02'),
          payments: [{ participantId: from, amount: money(amt, ccy) }],
          shares: allocate(money(amt, ccy), { kind: 'equal', among: [to] }, { seed: `t${String(k)}` }),
        })) },
      { weight: 1, arbitrary: fc.tuple(fc.constantFrom(...ids), fc.subarray(ids, { minLength: 1 }), fc.bigInt({ min: -50_000n, max: 50_000n }))
        .map(([from, among, amt]) => ({
          id: `a${String(k)}`, type: 'adjustment' as const, amount: money(amt, ccy), date: localDate('2026-07-03'), reason: 'test',
          payments: [{ participantId: from, amount: money(amt, ccy) }],
          shares: allocate(money(amt, ccy), { kind: 'equal', among }, { seed: `a${String(k)}` }),
        })) },
    );
    return fc.integer({ min: 0, max: maxE }).chain((m) => fc.tuple(...Array.from({ length: m }, (_, k) => arbEntry(k))))
      .map((entries) => ({ ccy, ids, entries: [...entries] }));
  });
}

/** Zero-sum Money balance vectors as (id, minor) pairs. */
export function arbZeroSumVector(maxN = 9, maxAbs = 50_000n): fc.Arbitrary<[ParticipantId, bigint][]> {
  return fc.integer({ min: 1, max: maxN }).chain((n) =>
    fc.array(fc.bigInt({ min: -maxAbs, max: maxAbs }), { minLength: n - 1, maxLength: n - 1 }).map((free) => {
      const last = -free.reduce((a, b) => a + b, 0n);
      return [...free, last].map((v, i) => [pid(`p${String(i).padStart(2, '0')}`), v] as [ParticipantId, bigint]);
    }));
}
