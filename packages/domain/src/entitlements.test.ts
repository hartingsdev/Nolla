import { describe, expect, it } from 'vitest';
import { check, effectiveRetentionDays, resolveLimits } from './index';

describe('entitlements (FR-12, D13)', () => {
  it('the v0.1 plan permits everything', () => {
    const limits = resolveLimits('unlimited');
    expect(check(limits, 'receipts.perTrip', 10n ** 9n)).toEqual({ ok: true });
    expect(check(limits, 'trips.active', 10n ** 9n)).toEqual({ ok: true });
  });
  it('a finite limit is compared in one place', () => {
    const limits = { ...resolveLimits('unlimited'), 'receipts.perTrip': 5n };
    expect(check(limits, 'receipts.perTrip', 5n)).toEqual({ ok: true });
    expect(check(limits, 'receipts.perTrip', 6n)).toEqual({ ok: false, key: 'receipts.perTrip', limit: 5n, usage: 6n });
  });
  it('retention: per-trip override, capped by the plan, 365 days by default (D11)', () => {
    const unlimited = resolveLimits('unlimited');
    expect(effectiveRetentionDays(unlimited, null)).toBe(365n);
    expect(effectiveRetentionDays(unlimited, 730n)).toBe(730n);
    expect(effectiveRetentionDays({ ...unlimited, 'retention.days': 400n }, 730n)).toBe(400n);
  });
});
