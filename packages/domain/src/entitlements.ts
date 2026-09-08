/**
 * Entitlements — requirements FR-12.1–12.3, D12, D13.
 *
 * Axis-agnostic on purpose: a plan is a bag of named limits. v0.1 ships one
 * plan that permits everything; the seams exist so a gating axis can be chosen
 * later without touching the domain.
 */

export type PlanId = 'unlimited';

export type LimitKey =
  | 'trips.active'          // number of open trips per account
  | 'receipts.perTrip'      // attachments per trip
  | 'receipts.bytesPerTrip' // total bytes per trip
  | 'retention.days';       // receipt retention after close

export type Limit = bigint | 'unlimited';
export type Limits = Readonly<Record<LimitKey, Limit>>;

const PLANS: Readonly<Record<PlanId, Limits>> = {
  unlimited: {
    'trips.active': 'unlimited',
    'receipts.perTrip': 'unlimited',
    'receipts.bytesPerTrip': 'unlimited',
    'retention.days': 'unlimited',
  },
};

export function resolveLimits(plan: PlanId): Limits {
  return PLANS[plan];
}

export type Check = { readonly ok: true } | { readonly ok: false; readonly key: LimitKey; readonly limit: bigint; readonly usage: bigint };

/** The one place a limit is compared to usage (FR-12.2). */
export function check(limits: Limits, key: LimitKey, usage: bigint): Check {
  const limit = limits[key];
  if (limit === 'unlimited' || usage <= limit) return { ok: true };
  return { ok: false, key, limit, usage };
}

/** Effective retention for a trip: the per-trip override, capped by the plan (FR-12.3). */
export function effectiveRetentionDays(limits: Limits, tripOverride: bigint | null, defaultDays = 365n): bigint {
  const wanted = tripOverride ?? defaultDays;
  const cap = limits['retention.days'];
  return cap === 'unlimited' ? wanted : (wanted < cap ? wanted : cap);
}
