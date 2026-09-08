import { type Money, type Precise, moneyToString, preciseToString } from '@vst/domain';

/**
 * Display formatting only. The value is converted to a JS number solely to
 * hand it to Intl; every calculation stays in the domain's bigint types.
 */
export function formatMoney(m: Money, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.ccy.code, minimumFractionDigits: m.ccy.exponent, maximumFractionDigits: m.ccy.exponent })
    .format(parseFloat(moneyToString(m)));
}

/** Full-precision display (for "stored exactly as …" notes). */
export function formatPrecise(p: Precise, locale: string): string {
  const s = preciseToString(p).replace(/0+$/, '').replace(/\.$/, '');
  return `${s} ${p.ccy.code}`.replace('.', locale.startsWith('de') ? ',' : '.');
}

export function formatDate(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1));
}

/** "24,80" / "24.80" / "-8.75" → canonical "24.80" or null. */
export function normalizeAmountInput(raw: string): string | null {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,3})?$/.test(t) || t === '-' ) return null;
  return t;
}
