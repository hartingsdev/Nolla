import { describe, expect, it } from 'vitest';
import { allows, transition } from './index';

const admin = { isAdmin: true, allBalancesZero: false };
describe('trip lifecycle (FR-8.7, I5)', () => {
  it('open → settling → closed, closing only at zero balances', () => {
    expect(transition('open', 'freeze', admin)).toEqual({ ok: true, status: 'settling' });
    expect(transition('settling', 'close', admin)).toEqual({ ok: false, reason: 'BALANCES_NOT_ZERO' });
    expect(transition('settling', 'close', { ...admin, allBalancesZero: true })).toEqual({ ok: true, status: 'closed' });
  });
  it('reopen works from settling and closed, not from open', () => {
    expect(transition('settling', 'reopen', admin)).toEqual({ ok: true, status: 'open' });
    expect(transition('closed', 'reopen', admin)).toEqual({ ok: true, status: 'open' });
    expect(transition('open', 'reopen', admin)).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
  });
  it('non-admins cannot transition at all', () => {
    expect(transition('open', 'freeze', { ...admin, isAdmin: false })).toEqual({ ok: false, reason: 'NOT_ADMIN' });
  });
  it('settling admits transfers only; closed admits nothing', () => {
    expect(allows('open', 'expense')).toBe(true);
    expect(allows('settling', 'expense')).toBe(false);
    expect(allows('settling', 'transfer')).toBe(true);
    expect(allows('closed', 'transfer')).toBe(false);
  });
});
