# Observability Plan — Prometheus + Grafana

Status: **Plan v1.0** · Date: 2026-09-08 · Implements NFR-12 for the backend
(architecture.md §6, §8). The scaffolding in `ops/` is checked in now so that
the API (milestone M5) is born instrumented rather than retrofitted.

---

## 1. What we want to know

Three questions, in priority order:

1. **Is the ledger correct?** Every trip's balances sum to zero and every entry
   satisfies I1 — continuously, not just in tests. A violation is a page.
2. **Is the service healthy?** Request rate, errors, duration (RED) per route;
   database health; sync feed lag; auth failures.
3. **Is it being used, and how?** Trips, entries, transfers per day; app
   versions in the field; settlement plan kinds chosen. Product signal, not
   alerting.

Everything is a Prometheus metric scraped from the API. No client-side
Prometheus: phones don't run exporters. What the app does reaches the backend
as requests, and the API labels those with `app_version` and `platform` so the
client is observable through the server.

## 2. Architecture

```
┌─────────────── apps/api container ───────────────┐
│  Hono/Fastify  ──▶  metrics middleware (RED)      │
│  use-cases     ──▶  business counters             │
│  invariant job ──▶  gauges (last run, violations) │──▶ GET /metrics (prom-client, bearer-protected)
└──────────────────────────────────────────────────┘
                     ▲ scrape 15s
        ┌────────────┴────────────┐
        │  Prometheus             │──▶ alert rules ──▶ Alertmanager ──▶ push / e-mail
        │  (retention 15d local)  │
        └────────────┬────────────┘
                     ▼ datasource
        ┌─────────────────────────┐        ┌──────────────────────┐
        │  Grafana                │        │  postgres_exporter   │◀── Postgres
        │  provisioned dashboards │        │  node_exporter/cAdv. │◀── host / containers
        └─────────────────────────┘        └──────────────────────┘
```

Portability (D3) holds: `prom-client` is the only dependency and it lives in
`apps/api/src/adapters/metrics.ts` behind a tiny `Metrics` port
(`counter`, `histogram`, `gauge`). The domain package never sees it. Any host
that can run three containers — or a managed Prometheus (Grafana Cloud,
Amazon Managed Prometheus) — works unchanged; the scrape config is the only
thing that moves.

## 3. Metric catalogue

Names follow Prometheus conventions (`vst_` prefix, base units, `_total` for
counters). Labels are bounded: never a trip id, user id or free text in a
label — those go in logs.

### 3.1 HTTP (RED), from one middleware

| Metric | Type | Labels | Note |
|---|---|---|---|
| `vst_http_requests_total` | counter | `route`, `method`, `status` | `route` is the pattern (`/trips/:id/entries`), never the concrete URL |
| `vst_http_request_duration_seconds` | histogram | `route`, `method` | buckets 5 ms … 5 s |
| `vst_http_requests_in_flight` | gauge | — | saturation |
| `vst_http_request_size_bytes` / `_response_size_bytes` | histogram | `route` | catches accidental fat sync responses |

### 3.2 Domain and correctness

| Metric | Type | Labels | Note |
|---|---|---|---|
| `vst_invariant_check_last_run_timestamp_seconds` | gauge | — | set by the nightly job (§6.6) |
| `vst_invariant_violations` | gauge | `kind` = `balance_sum`, `entry_sum`, `closed_trip_write` | the number that must be zero; alert on > 0 |
| `vst_invariant_trips_checked` | gauge | — | sanity: > 0 after each run |
| `vst_entry_writes_total` | counter | `type` (expense/transfer/adjustment), `op` (create/update/delete) | volume and mix |
| `vst_entry_validation_failures_total` | counter | `code` (DomainError code) | a spike means a client bug shipped |
| `vst_settlement_plans_total` | counter | `kind` (bilateral/optimal/hub), `search` (exact/greedy) | product signal; `greedy` > 0 means a >16-person trip exists |
| `vst_settlement_compute_seconds` | histogram | `kind` | the exact search must stay in milliseconds |
| `vst_rounding_residual_units_total` | counter | — | units absorbed at the settlement boundary; should be tiny and flat |

### 3.3 Sync and collaboration

| Metric | Type | Labels | Note |
|---|---|---|---|
| `vst_sync_polls_total` | counter | `result` = `changes`/`empty` | ratio tells whether 10 s polling is wasteful (A5) |
| `vst_sync_lag_seconds` | histogram | — | write time → first successful poll that included it |
| `vst_write_conflicts_total` | counter | `route` | 409s (FR-9.5); if this climbs, revisit concurrency |

### 3.4 Identity and access

| Metric | Type | Labels | Note |
|---|---|---|---|
| `vst_auth_attempts_total` | counter | `provider` (apple/google/email), `result` (ok/invalid/expired/rate_limited) | |
| `vst_magic_links_sent_total` | counter | `result` | via Notifier port |
| `vst_invites_total` | counter | `op` (created/accepted/revoked/expired) | |
| `vst_account_deletions_total` | counter | — | store-compliance signal (FR-1.9) |
| `vst_trip_scope_denied_total` | counter | — | 404s from the scope middleware; a burst = probing |

### 3.5 Infrastructure (exporters, no code)

- `postgres_exporter`: connections, transaction rate, deadlocks, replication
  lag later, `pg_stat_user_tables` for `entries`.
- `node_exporter` / cAdvisor: CPU, memory, disk of the API container.
- Object storage: `vst_blob_bytes_total` gauge (attachments table sum) and
  `vst_blob_operations_total{op,result}` from the BlobStore adapter, since the
  bucket itself is vendor-specific.
- Notifier: `vst_notifications_total{channel,result}`.

### 3.6 Client, as seen by the server

Every request carries `X-App-Version` and `X-Platform` headers; the RED
middleware copies them into `vst_client_requests_total{app_version,platform}`
(bounded: a handful of versions × 3 platforms). That is enough to see when an
OTA update has landed and whether an old version is still misbehaving.

## 4. Dashboards (provisioned, in `ops/grafana/dashboards/`)

1. **Ledger correctness** — the one that matters. `vst_invariant_violations`
   by kind as stat tiles (green at 0, red otherwise), last run age, trips
   checked, validation failures by code over time, write conflicts.
2. **API health** — RED per route, p50/p95/p99 latency, in-flight, 5xx ratio,
   client versions.
3. **Sync** — polls per second, hit ratio, lag histogram heatmap.
4. **Identity** — auth attempts by provider/result, magic links, invites,
   deletions, scope denials.
5. **Infrastructure** — Postgres and container vitals.

`ops/grafana/dashboards/ledger-correctness.json` is committed as the first
dashboard; the others are added as M5 lands their metrics.

## 5. Alerts (`ops/prometheus/alerts.yml`)

| Alert | Condition | Severity | Why |
|---|---|---|---|
| `LedgerInvariantViolated` | `vst_invariant_violations > 0` for 1 m | **page** | money is wrong; nothing else matters until this is 0 |
| `InvariantCheckStale` | `time() − vst_invariant_check_last_run_timestamp_seconds > 36h` | warn | the job didn't run; we are flying blind |
| `ApiDown` | `up{job="api"} == 0` for 2 m | page | |
| `HighErrorRate` | 5xx / all > 2 % over 5 m, with > 1 rps | page | |
| `SlowRequests` | p95 `vst_http_request_duration_seconds` > 1 s over 10 m | warn | NFR-2 |
| `ValidationFailureSpike` | rate of `vst_entry_validation_failures_total` > 0.1/s over 10 m | warn | a client is sending bad entries |
| `WriteConflictsRising` | rate of `vst_write_conflicts_total` > 0.05/s over 15 m | info | concurrency design signal |
| `AuthAbuse` | `vst_auth_attempts_total{result="rate_limited"}` rate > 1/s | warn | |
| `ScopeProbing` | rate of `vst_trip_scope_denied_total` > 0.5/s over 5 m | warn | someone enumerating trip ids |
| `PostgresDown` / `PostgresConnectionsHigh` | exporter | page / warn | |
| `SettlementSlow` | p99 `vst_settlement_compute_seconds` > 0.5 s | warn | the exact search should never get here |

Routing: page → push notification (Alertmanager → ntfy/Pushover/e-mail; the
channel is a deferral like D16), warn/info → a Grafana annotation and a daily
digest.

## 6. Logs and traces (deliberately minimal)

- Structured JSON logs to stdout with `request_id`, `trip_id`, `user_id`
  (hashed), `route`, `status`, `duration_ms`. Loki + Promtail are an optional
  add-on in `docker-compose.observability.yml`; not required for v0.1.
- Tracing: not in v0.1. If the sync path ever needs it, OpenTelemetry's Node
  SDK exports to Tempo; the `Metrics` port is designed so an OTel meter can
  replace `prom-client` without touching call sites.
- Error tracking (Sentry or similar) stays behind the `ErrorReporter` port
  (architecture.md §8) and is complementary, not a replacement.

## 7. Security of the metrics endpoint

`/metrics` carries counts only, but route patterns and error codes are still
information. It is served on a **separate internal port** (9464) not exposed
by the load balancer, and additionally requires a bearer token from the
environment (`METRICS_TOKEN`), which the Prometheus scrape config supplies.
Never on the public API port.

## 8. Local development

```
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d
# Prometheus  http://localhost:9090   Grafana http://localhost:3000 (admin / admin)
```

Prometheus scrapes `host.docker.internal:9464` so the API can run on the host
under `pnpm dev`. Dashboards and the datasource are provisioned from `ops/`;
edits made in the Grafana UI are exported back into `ops/grafana/dashboards/`
so the repo stays the source of truth.

## 9. Implementation checklist for M5

- [ ] `Metrics` port + `prom-client` adapter; registry exposed on :9464 with bearer check
- [ ] RED middleware with route-pattern labels and client version labels
- [ ] Counters in use-cases: entry writes, validation failures, settlement plans, conflicts
- [ ] Invariant job sets gauges and exits non-zero on violation (so a cron alert exists even without Prometheus)
- [ ] `postgres_exporter` in the compose file with a read-only role
- [ ] Alert rules loaded and `promtool check rules` in CI
- [ ] Dashboard JSON validated in CI (`jq .` at minimum)
- [ ] Runbook stubs for the two page-level alerts in `docs/runbooks/`
