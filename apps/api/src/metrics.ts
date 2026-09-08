/**
 * Metrics port + Prometheus client adapter (observability.md §3). Only this file
 * imports the client library; call sites use the small `Metrics` interface.
 */
import client from '@prometheus-io/client';

export interface Metrics {
  readonly http: { observe(route: string, method: string, status: number, seconds: number, client: { appVersion: string; platform: string }): void; inFlight(delta: 1 | -1): void };
  readonly entryWrites: (type: string, op: 'create' | 'update' | 'delete') => void;
  readonly validationFailure: (code: string) => void;
  readonly settlementPlan: (kind: string, search: 'exact' | 'greedy' | 'n/a', seconds: number) => void;
  readonly syncPoll: (result: 'changes' | 'empty') => void;
  readonly writeConflict: (route: string) => void;
  readonly auth: (provider: string, result: string) => void;
  readonly invite: (op: 'created' | 'accepted' | 'revoked') => void;
  readonly accountDeleted: () => void;
  readonly scopeDenied: () => void;
  readonly invariants: (report: { tripsChecked: number; balanceSum: number; entrySum: number; closedTripWrite: number }, atMs: number) => void;
  readonly render: () => Promise<string>;
  readonly contentType: string;
}

export function promMetrics(registry = new client.Registry()): Metrics {
  client.collectDefaultMetrics({ register: registry, prefix: 'vst_process_' });
  const p = 'vst_';
  const reqs = new client.Counter({ name: `${p}http_requests_total`, help: 'HTTP requests', labelNames: ['route', 'method', 'status'], registers: [registry] });
  const dur = new client.Histogram({ name: `${p}http_request_duration_seconds`, help: 'HTTP request duration', labelNames: ['route', 'method'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [registry] });
  const inflight = new client.Gauge({ name: `${p}http_requests_in_flight`, help: 'In-flight requests', registers: [registry] });
  const clientReqs = new client.Counter({ name: `${p}client_requests_total`, help: 'Requests by app version', labelNames: ['app_version', 'platform'], registers: [registry] });
  const writes = new client.Counter({ name: `${p}entry_writes_total`, help: 'Ledger writes', labelNames: ['type', 'op'], registers: [registry] });
  const vfail = new client.Counter({ name: `${p}entry_validation_failures_total`, help: 'Rejected entries', labelNames: ['code'], registers: [registry] });
  const plans = new client.Counter({ name: `${p}settlement_plans_total`, help: 'Settlement plans computed', labelNames: ['kind', 'search'], registers: [registry] });
  const planDur = new client.Histogram({ name: `${p}settlement_compute_seconds`, help: 'Settlement compute time', labelNames: ['kind'], buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1], registers: [registry] });
  const polls = new client.Counter({ name: `${p}sync_polls_total`, help: 'Change-feed polls', labelNames: ['result'], registers: [registry] });
  const conflicts = new client.Counter({ name: `${p}write_conflicts_total`, help: '409 conflicts', labelNames: ['route'], registers: [registry] });
  const auth = new client.Counter({ name: `${p}auth_attempts_total`, help: 'Sign-in attempts', labelNames: ['provider', 'result'], registers: [registry] });
  const invites = new client.Counter({ name: `${p}invites_total`, help: 'Invite operations', labelNames: ['op'], registers: [registry] });
  const deletions = new client.Counter({ name: `${p}account_deletions_total`, help: 'Account deletions', registers: [registry] });
  const denied = new client.Counter({ name: `${p}trip_scope_denied_total`, help: 'Trip-scope denials (404s)', registers: [registry] });
  const invLast = new client.Gauge({ name: `${p}invariant_check_last_run_timestamp_seconds`, help: 'Last invariant check', registers: [registry] });
  const invViol = new client.Gauge({ name: `${p}invariant_violations`, help: 'Invariant violations by kind', labelNames: ['kind'], registers: [registry] });
  const invTrips = new client.Gauge({ name: `${p}invariant_trips_checked`, help: 'Trips checked', registers: [registry] });
  return {
    http: {
      observe(route, method, status, seconds, c) { reqs.inc({ route, method, status: String(status) }); dur.observe({ route, method }, seconds); clientReqs.inc({ app_version: c.appVersion, platform: c.platform }); },
      inFlight(delta) { inflight.inc(delta); },
    },
    entryWrites: (type, op) => { writes.inc({ type, op }); },
    validationFailure: (code) => { vfail.inc({ code }); },
    settlementPlan: (kind, search, seconds) => { plans.inc({ kind, search }); planDur.observe({ kind }, seconds); },
    syncPoll: (result) => { polls.inc({ result }); },
    writeConflict: (route) => { conflicts.inc({ route }); },
    auth: (provider, result) => { auth.inc({ provider, result }); },
    invite: (op) => { invites.inc({ op }); },
    accountDeleted: () => { deletions.inc(); },
    scopeDenied: () => { denied.inc(); },
    invariants: (r, atMs) => {
      invLast.set(atMs / 1000); invTrips.set(r.tripsChecked);
      invViol.set({ kind: 'balance_sum' }, r.balanceSum); invViol.set({ kind: 'entry_sum' }, r.entrySum); invViol.set({ kind: 'closed_trip_write' }, r.closedTripWrite);
    },
    render: () => registry.metrics(),
    contentType: registry.contentType,
  };
}
