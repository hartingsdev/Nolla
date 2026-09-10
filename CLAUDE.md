# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A shared expense tracker for group vacations, replacing a spreadsheet. pnpm
workspace monorepo: Expo (iOS/Android/web) + Hono API + Postgres.

`docs/requirements.md` and `docs/architecture.md` are the source of truth for
scope and design — this file does not restate them. Requirements are cited by
number throughout the code (`FR-3.5`, `D8`, `P3`, `NFR-14 c`, `I1`); when a
comment names one, that document explains it. Decisions belong there, not here:
if you resolve an open question, edit the document and add a changelog entry.

## Commands

```
pnpm check                              # lint + typecheck + test — what CI runs
pnpm dev                                # API on :8080 (PGlite) + app on :8081, one Ctrl-C stops both
pnpm --filter @vst/domain test          # one package
pnpm --filter @vst/domain exec vitest run money.test.ts -t 'preserves sums'   # one file, one test
pnpm --filter @vst/mobile e2e           # Playwright: re-exports dist first, then runs
pnpm --filter @vst/mobile e2e:only      # Playwright against the EXISTING dist
pnpm install --frozen-lockfile          # what CI does first — run it before every push
```

`e2e:only` does not rebuild `dist`. After any change under `apps/mobile`, run
`e2e`, or you are testing the previous build and will believe a fix worked.

`pnpm install --frozen-lockfile` is the other one worth internalising: lint,
typecheck and tests all pass against a stale `node_modules`, so a `package.json`
that disagrees with `pnpm-lock.yaml` is invisible locally and fails every CI job
at step one. Note that `expo prebuild` rewrites the `android`/`ios` scripts in
`apps/mobile/package.json` — revert those two lines, never the whole file.

## Money

Two bigint-backed types in `packages/domain/src/money.ts`, and the distinction
is the core of the design (D8):

- `Money` — what a person actually pays. Signed integer minor units.
- `Precise` — what the system derives. Fixed-point, 8 fractional digits.

`roundAll(values, total, seed)` is the **only** Precise → Money conversion in the
codebase, and deliberately so: it rounds a whole set against the total it must
sum to, distributing the residual by largest remainder. There is no
single-value `round()`, and adding one would break the invariant that shares sum
to the amount. Floats are banned outright — ESLint forbids `Number()` and
`parseFloat` inside the domain, and `pnpm check:no-floats` fails any migration
declaring a float column.

`roundAll`'s tie-break is **positional**: it walks the values in array order
from `seedIndex(seed, n)`. Anything that reorders the inputs hands the residual
cent to a different person. This has already caused one real bug — a split rule
stored as a JSON object round-tripped through Postgres `jsonb`, which does not
preserve key order, so stored shares and recomputed shares disagreed by a cent.
Rule entries are therefore **ordered arrays, not maps** (`WireRuleEntry` in
`packages/domain/src/wire.ts`). Keep it that way, and when you touch anything
that crosses the database, write a round-trip test — the entire e2e suite was
green while that bug existed.

## Layout and boundaries

- `packages/domain` — pure. No framework, ORM, vendor SDK, or Node I/O; no
  ambient `Date.now()` or `Math.random()` (they come in through the `Clock` and
  `IdGen` ports in `ports.ts`). Enforced by ESLint (`packages/config/eslint.base.mjs`),
  so a violation fails the build rather than the review.
- `packages/contracts` — zod schemas for the wire, and the only package the
  domain is allowed to import. Money crosses the wire as a **string**, always:
  `"55.18"` for Money, `"11.03600000"` for Precise (8 digits, exactly). JSON
  numbers would reintroduce the floats the whole money model exists to avoid.
- `packages/persistence` — Drizzle repositories over Postgres. Invariants I1–I5
  live in the domain *and* as deferred constraint triggers in SQL.
- `apps/api` — Hono. Routes in `src/http`, adapters in `src/adapters`.
- `apps/mobile` — Expo Router. Screens in `app/`, everything else in `src/`;
  `src/sync/engine.ts` is the outbox and change-feed client.

Migrations are hand-written SQL in `packages/persistence/migrations`, applied in
filename order (Drizzle's migrator cannot express our triggers and functions).
`schema.ts` is a mirror of that SQL for query typing, and `migrate.test.ts`
asserts the two agree — change both together.

## Tests

Property tests on the domain (money, splits, settlement), catalogue tests on
i18n, and Playwright click tests in `apps/mobile/e2e` that assert what the user
sees — including that displayed balances always sum to zero. Persistence and API
tests run on PGlite (in-process Postgres) by default; set `DATABASE_URL` to run
them against a real one, which CI also does.

Playwright asserts against the DOM, so a defect in native layout can pass every
test. A umlaut once rendered clipped on web while the DOM text was correct.

## UI

Every user-visible string goes through i18next (EN source, DE shipped); ESLint
fails on literal JSX text. German is not a translation of convenience here — the
group using the app speaks it, and the existing spreadsheet is in it.
