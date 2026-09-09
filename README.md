# Vacation Spending Tracker

A shared expense tracker for group vacations — replaces the spreadsheet the
group currently keeps (per-person columns, `an wen?` payer column, hand-built
debt matrix) with a mobile-first app that splits costs, tracks who paid, and
computes a settlement plan.

## Status

Milestones M0–M9 are done: the app runs on iOS, Android and the web, against a
local ledger or a shared trip on the API. What is left before a real trip is
distribution (M10–M11), which needs Apple and Google developer accounts.

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

Q10 — how v0.1 reaches the group (TestFlight and Play internal testing, or
sideloaded dev builds) — blocks M10 and needs Apple and Google developer
accounts. Everything else is v0.2 work: an audit trail per entry (FR-10.2),
transfer dispute (FR-5.3), and the two narrower adjustment cases noted in the
requirements.

## Try it

Two ways in. The first needs nothing but Node.

**On this device only** — no account, no backend:

```
pnpm install
pnpm --filter @vst/mobile web        # http://localhost:8081
```

Settings → *Load sample trip* fills the ledger with the first rows of the real
spreadsheet; the overview then asks which participant you are.

**With a shared trip** — sign-in, invites and sync, still with no Docker and no
database to install (the API runs Postgres in-process via PGlite):

```
pnpm --filter @vst/api dev:pglite    # terminal 1 — API on :8080
pnpm --filter @vst/mobile web        # terminal 2 — app on :8081
```

Sign in with any e-mail address. Nothing is sent: the dev API captures the
magic link, so open <http://localhost:8080/dev/magic-links> and follow the URL
it lists. From there you can create a shared trip, invite a second browser
profile, and watch both sides converge.

**On a phone**: `pnpm --filter @vst/mobile start`, then scan the QR code with
Expo Go. Set `EXPO_PUBLIC_API_URL` to your machine's LAN address if you want
the phone to reach the dev API rather than `localhost`.

**Without installing anything but Docker:**

```
docker compose -f docker-compose.app.yml up --build
```

App on <http://localhost:8081>, API on <http://localhost:8080>, magic links at
<http://localhost:8080/dev/magic-links>. The first build installs the workspace
and runs the Expo web export inside the image, so give it several minutes; after
that `up` is quick.

This is a local demo stack: the API keeps Postgres in-process (PGlite — the data
is gone with the container), accepts fabricated identity tokens and serves the
magic links above, so don't expose it. `docker-compose.yml` is the other thing —
real Postgres, MinIO and Mailpit for development against the production code
path.

## Development

```
pnpm install            # Node 24, pnpm 10 (see .nvmrc / packageManager)
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
- [x] v0.2 — CSV export (FR-7.8), share and percentage splits (FR-3.5), per-person tip (FR-3.7), adjustments in both shapes (FR-6), audit trail (FR-10.2), transfer dispute (FR-5.3), participant rename with history (FR-1.12)
- [ ] M10–M11 — distribution (needs Apple/Google developer accounts), the trip
