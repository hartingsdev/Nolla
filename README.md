# Vacation Spending Tracker

A shared expense tracker for group vacations — replaces the spreadsheet the
group currently keeps (per-person columns, `an wen?` payer column, hand-built
debt matrix) with a mobile-first app that splits costs, tracks who paid, and
computes a settlement plan.

## Status

Requirements phase. No code yet.

- [Requirements & feature plan](docs/requirements.md) — scope, decision log, domain model,
  functional/non-functional requirements, settlement algorithm, release plan,
  open questions.
- [Architecture plan](docs/architecture.md) — package boundaries, money types,
  schema, API, identity flows, client design, ADRs, and the v0.1 build order.

## Decisions so far

React Native (Expo) shipping to both app stores plus a web build · accounts
required up front · multi-tenant schema, single group operated · hosting
deferred behind portability constraints · EUR only, multi-currency later ·
two-tier money precision (exact derived values, integer cents for anything
payable) · English source strings with German shipped · paid tiers planned,
billing deferred. Full rationale in §1.3 of the requirements.

## Next step

Start milestone M0 of the architecture plan (monorepo scaffold with the import
boundary rules), then M1 (money types and split allocation with property
tests). Q10 (how v0.1 reaches the group) must be settled before M10.

## Development

```
pnpm install            # Node 22, pnpm 10 (see .nvmrc / packageManager)
pnpm check              # lint + typecheck + test, what CI runs
pnpm --filter @vst/domain test:watch
pnpm --filter @vst/mobile web         # the app in a browser (Expo web)
pnpm --filter @vst/mobile e2e         # UI click tests: exports the web build (API URL :8090 baked in), boots the PGlite API, runs Playwright
pnpm --filter @vst/persistence test   # ledger schema tests on PGlite (in-process Postgres); set DATABASE_URL to use a real one
pnpm --filter @vst/persistence migrate           # apply migrations/*.sql to DATABASE_URL
pnpm --filter @vst/persistence check-invariants  # the nightly correctness job; exit 1 on any violation
pnpm --filter @vst/api retention                 # the receipt purge job (--dry-run to preview)
pnpm --filter @vst/api dev:pglite                # the API on :8080 with an in-process Postgres — no Docker, no DATABASE_URL
pnpm --filter @vst/api dev                       # the API on :8080 (+ metrics on :9464) via tsx, needs DATABASE_URL
pnpm --filter @vst/api build                     # esbuild → apps/api/dist/main.mjs, what the Dockerfile ships
pnpm --filter @vst/api test                      # HTTP tests through app.request() on PGlite
pnpm --filter @vst/mobile start       # Expo dev server for iOS/Android (Expo Go or a dev build)
docker compose up -d    # postgres, minio, mailpit for local API work (from M3 on)
```

Layout follows [docs/architecture.md](docs/architecture.md) §3. `packages/domain`
is pure: the import boundary (no framework, ORM, vendor SDK, Node I/O, ambient
clock or float conversion) is enforced by ESLint and fails the build.

Three layers of tests: property tests on the domain (money, splits, settlement),
catalogue tests on i18n, and Playwright click tests against the exported web
build (`apps/mobile/e2e`), which assert what the user sees — including that the
displayed balances always sum to zero. CI runs all three on every push.

## Progress

- [x] M0 — scaffold, boundary rules, CI, local services
- [x] M1 — money types, `roundAll` boundary, split allocation, property tests
- [x] M2 — ledger, balances, gross matrix, three settlement plans, lifecycle, entitlements
- [x] UI (pulled forward) — Expo app shell: overview, ledger, settle up, add expense, entry detail, participants, settings; local-only store; EN + DE
- [x] UI batch 2 — edit entries, date, multiple payers, direct payments, delete/restore, per-person drill-down, trip lifecycle (freeze/close/reopen) with write rules, trip name/currency
- [x] UI batch 3 — categories, per-share "mark paid" (FR-7.4), who-owes-whom matrix, "same again", ledger search and filters
- [x] Observability plan — [docs/observability.md](docs/observability.md); Prometheus/Grafana/Alertmanager stack and rules in `ops/`, `docker-compose.observability.yml`
- [x] M3 — Postgres schema with invariant triggers, Drizzle repositories, invariant job, tests on PGlite + real Postgres
- [x] M4 — identity: OIDC verification (Apple/Google), magic links, sessions, deletion
- [x] M5 — Hono API: trips, invites, participants, ledger + change feed, balances, settlement, lifecycle, metrics
- [x] M6 — shared trips in the app: sign-in (magic link), invites, claiming, sync engine with outbox + change feed, conflict notices
- [x] M9 — receipts (presigned uploads, retention job) and offline-write polish (queued badges, backoff, replay)
- [ ] M10–M11 — distribution (needs Apple/Google developer accounts), the trip
