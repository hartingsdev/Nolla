# Trip Ledger

Five people go on holiday. One books the house, another keeps buying the
groceries, a third fills up the car twice. Someone skips the theme park. There
is a refund. On the last evening everybody tries to work out who owes whom — and
whether the numbers even add up.

Splitting evenly is easy, and almost nothing on a trip splits evenly. One person
pays for four, someone was not there that day, a deposit comes back a week
later. Keep a running tally by hand and it holds until the first correction;
after that you are reconciling instead of packing.

Trip Ledger does that job on a phone. Enter what was spent and who it was for;
it keeps the balances, and when the trip is over it tells you the shortest set
of payments that clears everything.

## What it does

**Recording what happened.** An expense can be paid by several people at once and
split evenly, by shares (2 for a couple, 1 each for the rest), by percentage, or
by exact amounts. A tip can be entered per person and is split before the rest.
Refunds, deposits paid back and money that changed hands directly all have their
own entry type. Anything you got wrong can be edited, deleted and restored, and
*Same again* repeats an entry you make often.

**When plain expenses aren't enough.** An adjustment moves money between two
people, or between one person and everyone else, without pretending a payment
happened — for the cash someone handed over before the trip started. It always
carries a reason, and the reason stays with the entry.

**Settling up.** Three ways, and the app says what each one costs you:

- *Pay who you owe* — everyone pays exactly the person they owe. The most
  transfers, and no money passes through anyone else.
- *Fewest transfers* — the shortest list that clears every balance, marked
  *provably minimal* when it is, and telling you how many transfers it saves.
- *Via one person* — everyone settles with the same person, one transfer each.

There is also a who-owes-whom table for anyone who wants to see it before the
netting.

**Keeping everyone honest.** Every entry has a history: who created it, who
changed what, field by field, including who joined or left a split and how much
someone's share moved. If a payment is recorded that you never received, you —
and only you, as the recipient — can dispute it; it stays in the balances,
flagged, until it is resolved. Participants can be renamed, and the old names
stay visible.

**Getting the data back out.** Receipts photographed and attached to an entry
(shared trips only — they live on the server, not the phone). CSV export of
every entry, the totals and the settlement plan — one row per entry and one
column per person, so it opens in any spreadsheet program.

**On a trip, not in an office.** A trip can live on one phone with no account at
all, or be shared with the others through an invite link. Shared trips work with
no signal: entries are written on the device and reconcile when it comes back,
and you are told if someone changed the same entry meanwhile. English and German.

## The cent that doesn't divide

Split €10 three ways and someone gets 3.34. Do that fifty times over a fortnight
and it matters who — which is why the app never rounds a share and then adds the
rounded numbers up. Shares are held exactly, to eight decimal places, and only
the display is rounded. The one place a payable amount is produced, it is
produced for a whole split at once, against the total it has to match, so no cent
is ever invented or lost. The person who gets the extra cent rotates.

If a settlement leaves fractions under a cent hanging, the app shows them rather
than hiding them. The balances on the overview always sum to exactly zero, and a
test asserts that on every build against what is actually on screen.

## Get it

**On an Android phone** — this is a real installed app, not a web page:

<https://github.com/hartingsdev/claude-test/releases/download/android-latest/trip-ledger.apk>

Open that on the phone and tap it. Android asks once whether the browser may
install apps; say yes. Settings → *Load sample trip* fills it with a worked
example, so there is something to look at before you type anything.

The build is signed with a development key, which is fine for your own phone and
means two things: your phone will warn you it came from outside the Play Store,
and a Play Store version later cannot update it — that one needs an uninstall
first. iPhones need an Apple developer account, which is the next open question.

**In a browser**, if you have Node: `pnpm install` then
`pnpm --filter @vst/mobile web`. That is the whole app, in a browser.

**With a shared trip**, still without installing a database or Docker:

```
pnpm dev        # API on :8080, app on :8081
```

Sign in with any e-mail address — nothing is sent, the development server keeps
the link at <http://localhost:8080/dev/magic-links>. Open the app in a second
browser profile, follow an invite, and watch the two sides converge.

**With Docker instead of Node**: `docker compose -f docker-compose.app.yml up
--build`. Same two ports. It is a demo stack — the data lives in the container
and dies with it, and it accepts made-up identities, so don't put it online.

## Where it stands

Everything above is built and tested. What is missing is the part that has
nothing to do with code: the app stores need an Apple and a Google developer
account, and the app has not yet been through a real trip, which is the only
test that finds what is actually wrong with it.

## For developers

Documentation first — both of these are kept current, and the code cites them by
number (`FR-3.5`, `D8`, `I1`):

- [Requirements & feature plan](docs/requirements.md) — scope, decision log,
  domain model, the settlement algorithm, release plan, open questions.
- [Architecture plan](docs/architecture.md) — package boundaries, money types,
  schema, API, identity flows, client design, ADRs.
- [CLAUDE.md](CLAUDE.md) — the short version, plus the traps that have already
  cost someone an afternoon.

A pnpm workspace: Expo (iOS/Android/web) in `apps/mobile`, a Hono API in
`apps/api`, and a pure domain package under `packages` that owns the money and
the settlement maths. Packages are `@vst/*` after the workspace name,
`vacation-spending-tracker`.

```
pnpm install            # Node 24, pnpm 10 (see .nvmrc / packageManager)
pnpm dev                # API on :8080 (PGlite) and the app on :8081, one Ctrl-C stops both
pnpm check              # lint + typecheck + test, what CI runs
pnpm --filter @vst/mobile web         # the app in a browser (Expo web)
pnpm --filter @vst/mobile e2e         # UI click tests: re-exports the web build, boots the PGlite API, runs Playwright
pnpm --filter @vst/mobile start       # Expo dev server for iOS/Android (Expo Go or a dev build)
pnpm --filter @vst/domain test:watch
pnpm --filter @vst/persistence test              # ledger schema tests on PGlite; set DATABASE_URL to use a real Postgres
pnpm --filter @vst/persistence migrate           # apply migrations/*.sql to DATABASE_URL
pnpm --filter @vst/persistence check-invariants  # the nightly correctness job; exit 1 on any violation
pnpm --filter @vst/api dev:pglite                # the API on :8080 with an in-process Postgres — no Docker, no DATABASE_URL
pnpm --filter @vst/api dev                       # the API on :8080 (+ metrics on :9464) via tsx, needs DATABASE_URL
pnpm --filter @vst/api build                     # esbuild → apps/api/dist/main.mjs, what the Dockerfile ships
pnpm --filter @vst/api retention                 # the receipt purge job (--dry-run to preview)
docker compose up -d    # postgres, minio, mailpit for local API work
```

`packages/domain` is pure — no framework, ORM, vendor SDK, Node I/O, ambient
clock or float conversion — and ESLint fails the build rather than the review.
Three layers of tests: property tests on the domain, catalogue tests on i18n,
and Playwright click tests against the exported web build that assert what the
user sees. CI runs all three on every push, plus the persistence and API suites
against a real Postgres.

Android builds come out of the `android-apk` workflow: `expo prebuild` then
`gradlew assembleRelease` on a runner, about 25 minutes, published to the rolling
`android-latest` release. No Android SDK or Expo account needed anywhere.
`apps/mobile/eas.json` holds the profiles for the cloud route when there is an
account to run them with.

Decisions taken so far: React Native (Expo) to both stores plus a web build ·
accounts required up front · multi-tenant schema, single group operated · hosting
deferred behind portability constraints · EUR only, multi-currency later ·
two-tier money precision · English source strings with German shipped · paid
tiers planned, billing deferred. Rationale in §1.3 of the requirements.

<details>
<summary>Milestones</summary>

- [x] M0 — scaffold, boundary rules, CI, local services
- [x] M1 — money types, `roundAll` boundary, split allocation, property tests
- [x] M2 — ledger, balances, gross matrix, three settlement plans, lifecycle, entitlements
- [x] UI — overview, ledger, settle up, entry forms, per-person drill-down, participants, trip lifecycle, categories, search and filters, EN + DE
- [x] M3 — Postgres schema with invariant triggers, Drizzle repositories, invariant job, tests on PGlite + real Postgres
- [x] M4 — identity: OIDC verification (Apple/Google), magic links, sessions, deletion
- [x] M5 — Hono API: trips, invites, participants, ledger + change feed, balances, settlement, lifecycle, metrics
- [x] M6 — shared trips in the app: sign-in, invites, claiming, sync engine with outbox + change feed, conflict notices
- [x] M9 — receipts (presigned uploads, retention job) and offline-write polish
- [x] Observability — [docs/observability.md](docs/observability.md); Prometheus/Grafana/Alertmanager stack in `ops/`
- [x] v0.2 — CSV export, share and percentage splits, per-person tip, adjustments in both shapes, audit trail, transfer dispute, participant rename with history
- [x] Android sideload — `android-apk` workflow, APK on a rolling release
- [ ] M10–M11 — store distribution (needs Apple/Google developer accounts), the trip

</details>
