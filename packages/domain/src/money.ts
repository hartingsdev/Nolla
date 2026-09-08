/**
 * Money and precision model — requirements.md §5.1 (D8), rules P1–P7.
 *
 * Two representations, both bigint-backed so arithmetic is exact and identical
 * on client and server:
 *
 *   Money    — what a human pays: signed integer in the currency's minor unit.
 *   Precise  — what the system derives: fixed-point with 8 fractional digits of
 *              the MAJOR unit, stored as a scaled bigint.
 *
 * The only Precise → Money conversion in the codebase is `roundAll`, which
 * takes a whole set of values plus the total they must sum to (P3, P4). There
 * is deliberately no single-value `round(precise)`.
 */

import { DomainError } from './errors';

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

export interface Currency {
  readonly code: string;
  /** Number of decimal digits in the minor unit (ISO 4217). */
  readonly exponent: 0 | 2 | 3;
}

const EXPONENTS: Readonly<Record<string, 0 | 2 | 3>> = {
  EUR: 2, USD: 2, GBP: 2, CHF: 2, DKK: 2, SEK: 2, NOK: 2, PLN: 2, CZK: 2, HUF: 2,
  CAD: 2, AUD: 2, NZD: 2, TRY: 2, HRK: 2, RON: 2, BGN: 2, THB: 2, MXN: 2, BRL: 2,
  JPY: 0, KRW: 0, ISK: 0, VND: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
};

export function currency(code: string): Currency {
  const exponent = EXPONENTS[code];
  if (exponent === undefined) throw new DomainError('UNKNOWN_CURRENCY', `Unknown currency ${code}`);
  return { code, exponent };
}

export const PRECISE_DIGITS = 8;
export const PRECISE_SCALE = 10n ** BigInt(PRECISE_DIGITS);

/** Scaling factor from a currency's minor unit to Precise units. */
function minorToPreciseFactor(ccy: Currency): bigint {
  return 10n ** BigInt(PRECISE_DIGITS - ccy.exponent);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Money {
  readonly kind: 'money';
  readonly minor: bigint;
  readonly ccy: Currency;
}

export interface Precise {
  readonly kind: 'precise';
  readonly scaled: bigint;
  readonly ccy: Currency;
}

export function money(minor: bigint, ccy: Currency): Money {
  return { kind: 'money', minor, ccy };
}

export function precise(scaled: bigint, ccy: Currency): Precise {
  return { kind: 'precise', scaled, ccy };
}

export function zeroMoney(ccy: Currency): Money {
  return money(0n, ccy);
}

export function zeroPrecise(ccy: Currency): Precise {
  return precise(0n, ccy);
}

function assertSameCurrency(a: { ccy: Currency }, b: { ccy: Currency }): void {
  if (a.ccy.code !== b.ccy.code) {
    throw new DomainError('CURRENCY_MISMATCH', `${a.ccy.code} vs ${b.ccy.code}`);
  }
}

// ---------------------------------------------------------------------------
// Arithmetic (closed over each type; no cross-type arithmetic exists)
// ---------------------------------------------------------------------------

export const M = {
  add(a: Money, b: Money): Money { assertSameCurrency(a, b); return money(a.minor + b.minor, a.ccy); },
  sub(a: Money, b: Money): Money { assertSameCurrency(a, b); return money(a.minor - b.minor, a.ccy); },
  neg(a: Money): Money { return money(-a.minor, a.ccy); },
  sum(xs: readonly Money[], ccy: Currency): Money { return xs.reduce((acc, x) => M.add(acc, x), zeroMoney(ccy)); },
  eq(a: Money, b: Money): boolean { assertSameCurrency(a, b); return a.minor === b.minor; },
  isZero(a: Money): boolean { return a.minor === 0n; },
  cmp(a: Money, b: Money): -1 | 0 | 1 { assertSameCurrency(a, b); return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0; },
  abs(a: Money): Money { return a.minor < 0n ? M.neg(a) : a; },
  min(a: Money, b: Money): Money { return M.cmp(a, b) <= 0 ? a : b; },
} as const;

export const P = {
  add(a: Precise, b: Precise): Precise { assertSameCurrency(a, b); return precise(a.scaled + b.scaled, a.ccy); },
  sub(a: Precise, b: Precise): Precise { assertSameCurrency(a, b); return precise(a.scaled - b.scaled, a.ccy); },
  neg(a: Precise): Precise { return precise(-a.scaled, a.ccy); },
  sum(xs: readonly Precise[], ccy: Currency): Precise { return xs.reduce((acc, x) => P.add(acc, x), zeroPrecise(ccy)); },
  eq(a: Precise, b: Precise): boolean { assertSameCurrency(a, b); return a.scaled === b.scaled; },
  isZero(a: Precise): boolean { return a.scaled === 0n; },
  cmp(a: Precise, b: Precise): -1 | 0 | 1 { assertSameCurrency(a, b); return a.scaled < b.scaled ? -1 : a.scaled > b.scaled ? 1 : 0; },
  abs(a: Precise): Precise { return a.scaled < 0n ? P.neg(a) : a; },
  sign(a: Precise): -1 | 0 | 1 { return a.scaled < 0n ? -1 : a.scaled > 0n ? 1 : 0; },
} as const;

/** Lossless widening (P2): Money → Precise always succeeds. */
export function toPrecise(m: Money): Precise {
  return precise(m.minor * minorToPreciseFactor(m.ccy), m.ccy);
}

// ---------------------------------------------------------------------------
// Integer helpers (floor semantics, so remainders are always in [0, d))
// ---------------------------------------------------------------------------

export function floorDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new DomainError('INVALID_DIVISOR', `divisor must be positive, got ${String(d)}`);
  const q = n / d; // truncates toward zero
  return n < 0n && q * d !== n ? q - 1n : q;
}

export function floorMod(n: bigint, d: bigint): bigint {
  return n - floorDiv(n, d) * d;
}

// ---------------------------------------------------------------------------
// The boundary: Precise[] → Money[]  (P3, P4)
// ---------------------------------------------------------------------------

/** FNV-1a over a string; used only to rotate the tie-break start index. */
export function seedIndex(seed: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return n === 0 ? 0 : h % n;
}

/**
 * Round a set of Precise values to Money so that the results sum EXACTLY to
 * `total` (P4). Each value is first TRUNCATED toward zero to a minor unit; the
 * residual between that and `total` is then corrected one unit at a time on
 * the entries whose truncation discarded the most (largest remainder). Ties
 * are broken in stable index order starting at `seedIndex(seed, n)`, so the
 * same participant does not always absorb the extra unit.
 *
 * Truncating (rather than rounding to nearest, or flooring) is what makes P7
 * hold at the boundary: a vector of sub-unit leftovers such as
 * [+0.004, +0.006, −0.004, −0.006] rounds to all zeros, so no phantom cent is
 * ever proposed as a debt after everyone has paid. Nearest rounding would give
 * [0, +1, 0, −1]; floor-based largest remainder can too.
 *
 * Every result differs from its input by less than one minor unit.
 *
 * Precondition: Σ values == toPrecise(total). This is an invariant of the
 * callers (allocate guarantees it for shares; balances sum to zero for
 * settlement), so a violation is a bug, not an input error.
 */
export function roundAll(values: readonly Precise[], total: Money, seed: string): Money[] {
  const ccy = total.ccy;
  const n = values.length;
  if (n === 0) {
    if (total.minor !== 0n) throw new DomainError('ROUND_SUM_MISMATCH', 'cannot round zero values to a non-zero total');
    return [];
  }
  const f = minorToPreciseFactor(ccy);
  const sum = P.sum(values, ccy);
  if (sum.scaled !== total.minor * f) {
    throw new DomainError('ROUND_SUM_MISMATCH', `Σ values (${preciseToString(sum)}) != total (${moneyToString(total)})`);
  }

  // Truncate toward zero; keep the discarded remainder (value − truncated), which has the value's sign.
  const rounded: bigint[] = new Array<bigint>(n);
  const err: bigint[] = new Array<bigint>(n);
  let roundedSum = 0n;
  for (let i = 0; i < n; i++) {
    const v = (values[i] as Precise).scaled;
    const m = v / f; // bigint division truncates toward zero
    rounded[i] = m;
    err[i] = v - m * f;
    roundedSum += m;
  }
  const residual = total.minor - roundedSum; // units still to add (>0) or remove (<0)
  if (residual === 0n) return rounded.map((m) => money(m, ccy));

  const start = seedIndex(seed, n);
  const rot = (i: number) => (i - start + n) % n;
  const dir = residual > 0n ? 1n : -1n;
  // Candidates: entries whose error points in the direction we must move (most under-rounded first
  // when adding, most over-rounded first when removing).
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const ea = (err[a] as bigint) * dir;
    const eb = (err[b] as bigint) * dir;
    if (ea !== eb) return ea > eb ? -1 : 1;
    return rot(a) - rot(b);
  });
  let left = residual < 0n ? -residual : residual;
  for (const i of order) {
    if (left === 0n) break;
    rounded[i] = (rounded[i] as bigint) + dir;
    left -= 1n;
  }
  return rounded.map((m) => money(m, ccy));
}

// ---------------------------------------------------------------------------
// Serialisation: strings on the wire, never JSON numbers (P6)
// ---------------------------------------------------------------------------

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

function parseDecimal(s: string, fractionDigits: number, strictDigits: boolean, what: string): bigint {
  const m = DECIMAL_RE.exec(s);
  if (!m) throw new DomainError('PARSE_ERROR', `${what}: not a decimal string: ${JSON.stringify(s)}`);
  const [, sign, intPart, fracPart = ''] = m;
  if (fracPart.length > fractionDigits || (strictDigits && fracPart.length !== fractionDigits)) {
    throw new DomainError('PARSE_ERROR', `${what}: expected ${String(fractionDigits)} fractional digits, got ${String(fracPart.length)}`);
  }
  const padded = fracPart.padEnd(fractionDigits, '0');
  const magnitude = BigInt((intPart ?? '0') + padded);
  return sign === '-' ? -magnitude : magnitude;
}

function formatDecimal(v: bigint, fractionDigits: number): string {
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(fractionDigits + 1, '0');
  const intPart = abs.slice(0, abs.length - fractionDigits);
  const fracPart = abs.slice(abs.length - fractionDigits);
  return `${neg ? '-' : ''}${intPart}${fractionDigits > 0 ? '.' + fracPart : ''}`;
}

/** "55.18" → Money. Fraction digits must not exceed the currency's exponent. */
export function moneyFromString(s: string, ccy: Currency): Money {
  return money(parseDecimal(s, ccy.exponent, false, 'money'), ccy);
}

/** Money → "55.18" (always exactly `exponent` fraction digits; none for JPY). */
export function moneyToString(m: Money): string {
  return formatDecimal(m.minor, m.ccy.exponent);
}

/** "11.03600000" → Precise. Exactly 8 fractional digits required. */
export function preciseFromString(s: string, ccy: Currency): Precise {
  return precise(parseDecimal(s, PRECISE_DIGITS, true, 'precise'), ccy);
}

/** Precise → "11.03600000" (always 8 fractional digits). */
export function preciseToString(p: Precise): string {
  return formatDecimal(p.scaled, PRECISE_DIGITS);
}
