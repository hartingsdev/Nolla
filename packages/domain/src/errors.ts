export type DomainErrorCode =
  | 'UNKNOWN_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_DIVISOR'
  | 'PARSE_ERROR'
  | 'ROUND_SUM_MISMATCH'
  | 'INVALID_SPLIT'
  | 'SPLIT_RESIDUAL'
  | 'INVARIANT_VIOLATION';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
