/** Trip lifecycle — requirements FR-8.7, I5. */

export type TripStatus = 'open' | 'settling' | 'closed';
export type LifecycleAction = 'freeze' | 'reopen' | 'close';

export interface LifecycleContext {
  readonly isAdmin: boolean;
  /** Every balance is zero at Money precision (after roundAll). */
  readonly allBalancesZero: boolean;
}

export type TransitionResult =
  | { readonly ok: true; readonly status: TripStatus }
  | { readonly ok: false; readonly reason: 'NOT_ADMIN' | 'INVALID_TRANSITION' | 'BALANCES_NOT_ZERO' };

/**
 *   open ──freeze──▶ settling ──close (all zero)──▶ closed
 *     ▲                 │                              │
 *     └────reopen───────┴──────────reopen (logged)─────┘
 */
export function transition(status: TripStatus, action: LifecycleAction, ctx: LifecycleContext): TransitionResult {
  if (!ctx.isAdmin) return { ok: false, reason: 'NOT_ADMIN' };
  switch (action) {
    case 'freeze':
      return status === 'open' ? { ok: true, status: 'settling' } : { ok: false, reason: 'INVALID_TRANSITION' };
    case 'close':
      if (status !== 'settling') return { ok: false, reason: 'INVALID_TRANSITION' };
      return ctx.allBalancesZero ? { ok: true, status: 'closed' } : { ok: false, reason: 'BALANCES_NOT_ZERO' };
    case 'reopen':
      return status === 'open' ? { ok: false, reason: 'INVALID_TRANSITION' } : { ok: true, status: 'open' };
  }
}

/** Which writes a status admits (FR-8.7, I5). */
export function allows(status: TripStatus, write: 'expense' | 'transfer' | 'adjustment' | 'membership'): boolean {
  switch (status) {
    case 'open': return true;
    case 'settling': return write === 'transfer';
    case 'closed': return false;
  }
}
