// Wire-level schemas shared by client and server. Money is ALWAYS a string on
// the wire (requirements §5.1 P6): "55.18" for Money, "11.03600000" for Precise.
import { z } from 'zod';

export const currencyCode = z.string().length(3).regex(/^[A-Z]{3}$/);
export type CurrencyCode = z.infer<typeof currencyCode>;

/** A payable amount: optional sign, digits, optional fraction up to the currency's exponent (validated in domain). */
export const moneyString = z.string().regex(/^-?\d+(\.\d{1,3})?$/, 'money must be a decimal string');
/** A derived amount: optional sign, digits, exactly 8 fractional digits. */
export const preciseString = z.string().regex(/^-?\d+\.\d{8}$/, 'precise must have 8 fractional digits');
