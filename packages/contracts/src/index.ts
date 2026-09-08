// Wire-level schemas shared by client and server. Money is ALWAYS a string on
// the wire (requirements §5.1 P6): "55.18" for Money, "11.03600000" for Precise.
import { z } from 'zod';

export const currencyCode = z.string().regex(/^[A-Z]{3}$/);
/** A payable amount: optional sign, digits, optional fraction up to 3 digits (currency exponent validated in the domain). */
export const moneyString = z.string().regex(/^-?\d{1,15}(\.\d{1,3})?$/, 'money must be a decimal string');
/** A derived amount: exactly 8 fractional digits. */
export const preciseString = z.string().regex(/^-?\d{1,15}\.\d{8}$/, 'precise must have 8 fractional digits');
export const uuid = z.uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoInstant = z.iso.datetime();

export const entryType = z.enum(['expense', 'transfer', 'adjustment']);
export const tripStatus = z.enum(['open', 'settling', 'closed']);
export const lifecycleAction = z.enum(['freeze', 'reopen', 'close']);
export const planKind = z.enum(['bilateral', 'optimal', 'hub']);

export const wirePayment = z.object({ participantId: uuid, amount: moneyString });
export const wireShare = z.object({ participantId: uuid, amount: preciseString, settledBy: uuid.optional() });
export const wireEntry = z.object({
  id: uuid,
  type: entryType,
  description: z.string().min(1).max(200),
  amount: moneyString,
  ccy: currencyCode,
  date: isoDate,
  payments: z.array(wirePayment).min(1).max(50),
  shares: z.array(wireShare).min(1).max(100),
  reason: z.string().max(500).optional(),
  category: z.string().max(40).optional(),
  createdAt: isoInstant,
  deleted: z.boolean().optional(),
});
export type WireEntryInput = z.infer<typeof wireEntry>;

export const entryRecord = wireEntry.extend({ tripId: uuid, version: z.number().int().positive(), seq: z.string(), updatedAt: isoInstant });

export const createTrip = z.object({
  id: uuid,
  name: z.string().min(1).max(100),
  baseCcy: currencyCode,
  timezone: z.string().min(1).max(64).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});
export const patchTrip = z.object({
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).max(64).optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
});
export const transition = z.object({ action: lifecycleAction });

export const addParticipant = z.object({ id: uuid, displayName: z.string().min(1).max(60), joinedAt: isoDate.optional() });

export const providerSignIn = z.object({ token: z.string().min(10).max(8192) });
export const emailRequest = z.object({ email: z.string().max(254) });
export const emailVerify = z.object({ token: z.string().min(10).max(512) });

export const settlementQuery = z.object({ plan: planKind.default('optimal'), hub: uuid.optional() });
export const changesQuery = z.object({ since: z.string().regex(/^\d+$/).default('0'), limit: z.coerce.number().int().min(1).max(1000).default(500) });

export const settleShare = z.object({ participantId: uuid, transferEntryId: uuid.nullable() });

export const RECEIPT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const RECEIPT_MAX_BYTES = 8 * 1024 * 1024;
export const createAttachment = z.object({ id: uuid, mime: z.enum(RECEIPT_MIMES), bytes: z.number().int().positive().max(RECEIPT_MAX_BYTES) });
