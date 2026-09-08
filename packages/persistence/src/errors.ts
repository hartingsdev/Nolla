export class NotFoundError extends Error {
  constructor(what: string) { super(`${what} not found`); this.name = 'NotFoundError'; }
}
export class ConflictError<T> extends Error {
  constructor(readonly current: T) { super('version conflict'); this.name = 'ConflictError'; }
}
export class ForbiddenWriteError extends Error {
  constructor(msg: string) { super(msg); this.name = 'ForbiddenWriteError'; }
}
