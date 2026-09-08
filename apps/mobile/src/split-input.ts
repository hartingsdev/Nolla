/**
 * Parsing and formatting for the share and percentage split inputs (FR-3.5).
 * Separate from the form so the number handling can be tested without mounting
 * React Native — the trailing-zero case below was a real bug the e2e run caught.
 */
import { BPS_TOTAL } from '@vst/domain';

/** Whole shares: "2" → 2n. An untouched row counts as one share, so the default is an equal split. */
export const parseWeight = (raw: string | undefined): bigint => {
  const d = (raw ?? '1').replace(/\D/g, '').slice(0, 4);
  return d === '' ? 0n : BigInt(d);
};

/** Percent with two decimals → basis points: "33,34" → 3334n. */
export const parseBps = (raw: string | undefined): bigint => {
  const n = (raw ?? '').replace(',', '.').replace(/[^\d.]/g, '');
  if (n === '') return 0n;
  const [i = '', f = ''] = n.split('.');
  return BigInt(i === '' ? '0' : i) * 100n + BigInt(`${f}00`.slice(0, 2));
};

/** Even percentages that still add to exactly 100%: the remainder goes one basis point at a time. */
export const seedPercents = (ids: readonly string[], locale: string): Record<string, string> => {
  const n = BigInt(ids.length);
  if (n === 0n) return {};
  const base = BPS_TOTAL / n;
  const rest = BPS_TOTAL % n;
  return Object.fromEntries(ids.map((id, i) => [id, bpsToText(base + (BigInt(i) < rest ? 1n : 0n), locale)]));
};

/** 3334n → "33.34", trailing zero trimmed, in the input's own decimal separator. */
export function bpsToText(bps: bigint, locale: string): string {
  const neg = bps < 0n;
  const a = neg ? -bps : bps;
  const frac = String(a % 100n).padStart(2, '0').replace(/0+$/, '');
  const s = `${String(a / 100n)}${frac === '' ? '' : `.${frac}`}`;
  return `${neg ? '-' : ''}${locale.startsWith('de') ? s.replace('.', ',') : s}`;
}
