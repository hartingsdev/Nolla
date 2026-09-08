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
pnpm --filter @vst/mobile e2e         # UI click tests: exports the web build, serves it, runs Playwright
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
- [ ] M3 — schema + persistence (Drizzle)
- [ ] M4 — identity
- [ ] M5 — API (framework: to be decided — Hono or Fastify)
- [ ] M6–M11 — client, distribution, the trip
