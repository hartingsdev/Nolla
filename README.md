# Vacation Spending Tracker

A shared expense tracker for group vacations — replaces the spreadsheet the
group currently keeps (per-person columns, `an wen?` payer column, hand-built
debt matrix) with a mobile-first app that splits costs, tracks who paid, and
computes a settlement plan.

## Try it

Five ways in, ordered by what you need installed. None of them needs a hosted
server, a real database, or an account with anyone.

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

**On a phone, quickly**: `pnpm --filter @vst/mobile start`, then scan the QR code
with Expo Go. Set `EXPO_PUBLIC_API_URL` to your machine's LAN address if you want
the phone to reach the dev API rather than `localhost`.

**As a real installed app on Android** — no Expo account, no Play Console, no
Android SDK anywhere. Actions → *android-apk* → *Run workflow* (`expo prebuild`
then `gradlew assembleRelease` on a GitHub runner, ~25 minutes). It attaches the
build to a rolling prerelease, so the phone opens one unchanging link:

<https://github.com/hartingsdev/claude-test/releases/download/android-latest/trip-ledger.apk>

Tapping it installs; Android asks once whether the browser may install apps. The
run also uploads the usual workflow artifact, but a phone cannot use it — GitHub
requires a signed-in session to download artifacts even from a public repository,
and wraps them in a zip that the package installer will not open.

It is signed with the shared debug keystore Expo's template ships: fine for your
own phone, unfit for anything else, and a Play Console keystore later (M10) will
force an uninstall before it can replace this build. `apps/mobile/eas.json` holds
the profiles for the cloud route when there is an Expo account to run them with.

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

## Status

Feature-complete for what a trip needs, and not yet used on one. Expenses with
uneven splits, multiple payers, adjustments and refunds; balances and three
settlement plans; receipts; CSV export; an audit trail per entry; offline writes
that reconcile when the phone comes back. It runs on iOS, Android and the web,
against a ledger on the device or a shared trip on the API. An installable
Android build comes out of CI, so getting it onto a phone waits on nothing.

Milestones M0–M9 and v0.2 are done; store distribution (M10–M11) still needs
Apple and Google developer accounts. The two documents below track all of it.

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

The app is on a phone now, which makes UI feedback from real use the queue that
matters — the screens have been reviewed in a browser, at a desk, by the person
who wrote them. Q10 — how v0.1 reaches the *rest* of the group (TestFlight and
Play internal testing, or sideloaded builds all round) — still blocks M10 and
still needs the developer accounts.

## Development

```
pnpm install            # Node 24, pnpm 10 (see .nvmrc / packageManager)
pnpm dev                # API on :8080 (PGlite) and the app on :8081, one Ctrl-C stops both
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
- [x] Android sideload — `android-apk` workflow: prebuild + `assembleRelease` on CI, APK as an artifact, no account and no local SDK
- [ ] M10–M11 — store distribution (needs Apple/Google developer accounts), the trip
