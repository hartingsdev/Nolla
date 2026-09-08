# Vacation Spending Tracker — Architecture Plan

Status: **Draft v1.0** · Date: 2026-09-08 · Companion to [requirements.md](requirements.md) v1.3

This document turns the requirements into a buildable shape: package
boundaries, the money types, the schema, the API, the auth flows, and a build
order for v0.1. Where the requirements say *what*, this says *how* and *in what
order*. Decision references (D1…D16), requirement IDs (FR/NFR), invariants
(I1…I5) and precision rules (P1…P7) are the ones defined there.

---

## 1. Constraints this architecture must satisfy

Pulled from the decision log, these are the load-bearing ones:

| Constraint | Source | Architectural consequence |
|---|---|---|
| One TypeScript codebase → iOS, Android, web | D1, D9 | Expo (React Native) monorepo; web is a first-class target, not an afterthought |
| Accounts required; Sign in with Apple parity; in-app deletion | D2, FR-1.9, FR-1.10 | Own identity layer that verifies OIDC tokens and owns sessions — no vendor auth in the core |
| Hosting undecided, must scale | D3, NFR-14 | `trip_id` on every row; no cross-trip queries; domain package with zero framework/vendor imports; API is a stateless container |
| Multi-tenant from day one | D5, NFR-3 | Trip is the tenant; every query is scoped by membership |
| Two-tier money precision | D8, §5.1 | Two distinct types; one boundary function; no floats anywhere including JSON |
| Every entry type has the same shape | §5 | One `entries` + `payments` + `shares` structure for expenses, transfers, adjustments |
| Balances are derived, never stored | FR-9.3 | The same domain code computes balances on client and server from the ledger |
| English source, German shipped | D10 | String catalogue and a lint rule from the first commit |
| Entitlements axis-agnostic, no billing | D12, D13 | One `Entitlements` service resolving plan → named limits; nothing else reads plans |
| Retention metadata now, purge later | D11 | `retention_days` on trips, `uploaded_at` on attachments, from migration 0001 |
| Providers behind ports | D16 | `Notifier`, `BlobStore`, `IdentityVerifier` interfaces; adapters live outside the core |
| Offline read now, offline write later | FR-11.1, FR-11.2 | Client-generated IDs and a per-trip change sequence from day one so the outbox is an addition, not a redesign |

---

## 2. System overview

```
┌──────────────────────────── apps/mobile (Expo) ────────────────────────────┐
│  UI (expo-router)  ←→  local store (SQLite / IndexedDB)  ←→  sync client   │
│                              ▲                                              │
│                    packages/domain (balances, settlement, split)            │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │ HTTPS · JSON (money as strings)
┌────────────────────────────────────────▼────────────────────────────────────┐
│  apps/api (Hono on Node, stateless container)                               │
│  ┌ http layer ─ zod contracts ─ auth middleware ─ trip-scope middleware ┐    │
│  │  use-cases  →  packages/domain  →  ports: Repo · Notifier · BlobStore│    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  adapters: persistence (Drizzle/Postgres) · smtp · expo-push · s3-compatible │
└──────┬──────────────────────────┬───────────────────────────┬───────────────┘
       ▼                          ▼                           ▼
   Postgres                 object storage              e-mail / push
 (any managed)            (any S3-compatible)          (any, via port)
```

Two things to notice. The **domain package runs in both places**: the client
computes balances and settlement plans from its cached ledger with the same code
the server uses, so "derived, never stored" is true end to end and offline read
is free. And the **API is a plain stateless container** with three external
dependencies behind ports, which is what D3 needs to keep the host swappable.

---

## 3. Repository layout

pnpm workspaces, TypeScript throughout, strict mode everywhere.

```
.
├── apps/
│   ├── mobile/            Expo app: iOS, Android, web (expo-router)
│   └── api/               Hono HTTP server + use-cases + adapters
├── packages/
│   ├── domain/            PURE. Money, Precise, split, ledger, settlement,
│   │                      lifecycle, entitlements, CSV export. No I/O, no
│   │                      framework, no vendor, no Date.now() (Clock port).
│   ├── contracts/         zod schemas for every request/response; shared
│   │                      by client and server; money fields are strings.
│   ├── persistence/       Drizzle schema, migrations (SQL, committed),
│   │                      repository implementations. The only package
│   │                      that imports the ORM.
│   ├── i18n/              Message catalogues: en (source), de.
│   └── config/            Shared eslint / tsconfig / prettier.
├── docs/                  requirements.md, architecture.md, ADRs
├── docker-compose.yml     postgres + minio + mailpit for local dev
└── .github/workflows/     ci.yml
```

**Import rules, enforced by ESLint `no-restricted-imports` (build fails):**

- `packages/domain` may import nothing outside itself except `packages/contracts`
  types. No `drizzle`, no `hono`, no `react`, no `expo-*`, no `aws-sdk`.
- `packages/contracts` imports nothing but `zod`.
- `apps/api` imports `domain`, `contracts`, `persistence`; adapters for
  Notifier/BlobStore live in `apps/api/src/adapters/` and are the only files
  allowed to import provider SDKs.
- `apps/mobile` imports `domain`, `contracts`, `i18n`. Never `persistence`.

This is NFR-14(c) as a machine-checked rule rather than a convention.

---

## 4. The domain package

Everything here is a pure function over plain data. Two ports only: `Clock`
(for "today" in the trip's timezone) and `IdGen` (UUIDv7).

### 4.1 Money types

```ts
// Money: what a human pays. Integer minor units. Currency-aware exponent.
type Money   = { readonly kind: 'money';   readonly minor: bigint; readonly ccy: Currency };
// Precise: what the system derives. Fixed-point, 8 fractional digits of the MAJOR unit.
type Precise = { readonly kind: 'precise'; readonly scaled: bigint; readonly ccy: Currency };

const SCALE = 10n ** 8n;                       // 1.00000000 major unit
const exponent: Record<Currency, 0|2|3> = { EUR: 2, USD: 2, JPY: 0, BHD: 3, /*…*/ };

function toPrecise(m: Money): Precise;         // lossless: minor * 10^(8 - exp)
function roundAll(xs: Precise[], total: Money, seed: string): Money[];
//   THE boundary function (P3, P4). Largest-remainder allocation so that
//   Σ result == total exactly. Ties broken by index, starting at
//   hash(seed) mod n so the same participant does not always take the
//   extra unit. This is the only Precise → Money conversion in the codebase;
//   the type system provides no other path (FR-9.2).
```

Both are `bigint`-backed. No decimal library: fixed-point on `bigint` is exact,
fast, dependency-free and serialises trivially. **On the wire and in JSON, both
are strings** (`"55.18"`, `"11.03600000"`) — never JSON numbers (P6). Postgres
columns are `BIGINT` for `Money.minor` and `NUMERIC(20,8)` for `Precise`
(or `BIGINT` scaled, if the team prefers — either is exact; `NUMERIC` makes
the invariant constraints readable in SQL).

### 4.2 Split allocation

```ts
type SplitRule =
  | { kind: 'equal';   among: ParticipantId[] }
  | { kind: 'weights'; weights: Record<ParticipantId, bigint> }
  | { kind: 'percent'; pct: Record<ParticipantId, Precise> }     // must sum to 100
  | { kind: 'exact';   amounts: Record<ParticipantId, Money> };  // must sum to total

function allocate(total: Money, rule: SplitRule, surcharges?: Surcharge[]): Share[];
```

- `equal`, `weights`, `percent` produce `Precise` shares that sum to the total
  *exactly* by construction: divide at 8 dp, then distribute the 10⁻⁸ residual
  by largest remainder (P5). €55.18 / 5 → five shares of exactly `11.03600000`.
- `exact` takes `Money` typed by a human and **rejects** a set that does not sum
  to the total (FR-3.6). The UI offers "assign remainder to …" *before* calling
  `allocate`, never inside it.
- Surcharges (tips, FR-3.7) are per-participant `Money` added on top after the
  base allocation; the entry total includes them.

### 4.3 Ledger and balances

```ts
type Entry = { id; tripId; type: 'expense'|'transfer'|'adjustment'; amount: Money;
               date: LocalDate; payments: Payment[]; shares: Share[]; version; … };

function validate(e: Entry): Result<Entry, InvariantViolation>;   // I1 at Precise precision
function balances(entries: Entry[]): Map<ParticipantId, Precise>;  // Σ payments − Σ shares
function tripCost(entries: Entry[]): Money;                         // expenses only (I4)
function outstanding(entries, settledMarks): …                      // FR-7.3
```

`balances` is the single source of truth for "who owes what", called by the
server for `GET /balances` and by the client from its cache. Because every entry
type has the same shape, there is one loop and no special-casing.

### 4.4 Settlement

```ts
type Plan = { transfers: { from; to; amount: Money }[]; residualAssignedTo?: ParticipantId };

function settle(bal: Map<ParticipantId, Precise>, opts:
  | { kind: 'bilateral'; matrix: GrossMatrix }
  | { kind: 'optimal' }
  | { kind: 'hub'; hub: ParticipantId }): Plan;
```

Steps, in order:

1. **Round the balance vector** to `Money` with `roundAll` (P4) so the rounded
   balances still sum to zero. Whoever absorbs the sub-cent residual is
   recorded on the plan for the UI (FR-9.6).
2. Drop zero balances.
3. Match:
   - *bilateral* — net each pair of the gross matrix (FR-8.2).
   - *optimal* — exact for n ≤ 16, greedy above (FR-8.3). Exact: for each
     subset mask, `dp[mask] = max over i∈mask of dp[mask∖i] + [sum(mask)=0]`;
     the maximum number of disjoint zero-sum groups is `dp[full]`, the plan
     size is `n − dp[full]`, and greedy inside each group yields exactly
     `|group| − 1` transfers. O(2ⁿ·n): 1 M steps at n = 16, verified against
     brute force. Greedy alone is not minimal — `[+2,+3,−4,−5,+4]` is 4 vs 3.
   - *hub* — every non-zero non-hub member transfers with the hub (FR-8.5).
4. Sort transfers by (from, to) for a deterministic, stable plan.

Post-conditions asserted in tests: applying the plan zeroes every balance; no
member is both sender and receiver; recomputation is identical.

### 4.5 Lifecycle and entitlements

```ts
function transition(trip, action: 'freeze'|'reopen'|'close', actor): Result<Trip>;
// open →freeze→ settling →(all balances zero at Money precision)→ closed   (I5)

type Limits = Record<LimitKey, bigint | 'unlimited'>;   // axis-agnostic (D13)
function resolveLimits(plan: Plan): Limits;
function check(limits: Limits, key: LimitKey, usage: bigint): 'ok' | 'exceeded';
```

v0.1 has one plan, `unlimited`, and `check` is called in the places a limit
*could* apply (receipt upload, trip creation) so the seams exist. Nothing else
in the codebase knows a plan exists (FR-12.2).

### 4.6 Tests

`vitest` + `fast-check`. Properties, each over randomly generated trips
(2–20 participants, 0–500 entries, all split kinds, negative amounts, transfers,
adjustments):

- I1 holds for every `allocate` output; I2 holds for every `balances` output.
- `roundAll` output sums to its total; changing `seed` only permutes who takes
  the residual.
- `settle` post-conditions above, for all three kinds; optimal ≤ greedy ≤ n−1.
- Serialisation round-trips: `Money`/`Precise` → string → back is identity.
- `[+2,+3,−4,−5,+4]` and the other known-hard cases as fixed unit tests
  (NFR-13).

### 4.7 Export

`tripCsv` (FR-7.8) turns a trip into the shape of the sheet it replaces: one row
per entry, a reason column for adjustments (FR-6.1), one column per participant
holding that person's share, then the totals block and the settlement plan. It stays in the domain because it is a
pure function over the same ledger the screens read — which is what makes the
export and the balances impossible to disagree.

Three details are load-bearing:

- **Shares print at their real precision, amounts at the currency's.** A share is
  `Precise` (D8), so `€55.18 / 5` exports as `11.036`, not `11.04`. Rounding it
  for the file would produce a spreadsheet whose columns do not add up.
- **The dialect is a parameter.** German Excel reads `,` as the decimal point, so
  the field separator moves to `;` (`csvDialect`). Wrong here and every amount
  arrives as text.
- **Free text is escaped against formula injection**: a description starting `=`,
  `+`, `-` or `@` gets a leading apostrophe. Amount cells are built by the module
  itself and never pass through that guard, so negative amounts stay numbers.

The caller supplies the timestamp (Clock), the translated headings (D10) and the
platform write — a download on web, the share sheet on a phone.

---

## 5. Data model (Postgres)

All money columns are exact types. Every tenant-scoped table carries `trip_id`
and an index that starts with it. IDs are UUIDv7 (time-ordered, generated
client-side for entries so offline creation is idempotent later).

```sql
-- identity
users            (id, email UNIQUE NULL, display_name, plan TEXT NOT NULL DEFAULT 'unlimited',
                  created_at, deleted_at)
auth_identities  (user_id FK, provider ENUM('apple','google','email'), subject, UNIQUE(provider, subject))
sessions         (id, user_id FK, token_hash BYTEA UNIQUE, expires_at, last_seen_at)
magic_links      (token_hash UNIQUE, email, expires_at, used_at)

-- tenancy
trips            (id, name, base_ccy CHAR(3), timezone, start_date, end_date,
                  status ENUM('open','settling','closing','closed'),
                  retention_days INT NOT NULL DEFAULT 365,        -- D11 / FR-12.4
                  created_by FK users, seq BIGINT NOT NULL DEFAULT 0,  -- change cursor, §6.3
                  created_at, updated_at)
memberships      (trip_id FK, user_id FK, role ENUM('member','admin'), PRIMARY KEY(trip_id, user_id))
participants     (id, trip_id FK, display_name, user_id FK NULL,   -- NULL = placeholder
                  joined_at DATE, left_at DATE NULL, tombstoned_at NULL,
                  UNIQUE(trip_id, user_id) WHERE user_id IS NOT NULL)
invites          (token_hash UNIQUE, trip_id FK, created_by, expires_at, revoked_at)

-- ledger
entries          (id, trip_id FK, type ENUM('expense','transfer','adjustment'),
                  description, amount_minor BIGINT, ccy CHAR(3), fx_rate NUMERIC(20,10) NULL,
                  date DATE, category TEXT NULL, note TEXT NULL, reason TEXT NULL,
                  split_rule JSONB,                                 -- kept for re-allocation / display
                  version INT NOT NULL DEFAULT 1, seq BIGINT,      -- per-trip change sequence
                  created_by, created_at, updated_at, deleted_at NULL)
payments         (entry_id FK, trip_id, participant_id FK, amount_minor BIGINT, PRIMARY KEY(entry_id, participant_id))
shares           (entry_id FK, trip_id, participant_id FK, amount NUMERIC(20,8), weight BIGINT NULL,
                  settled_at NULL,                                   -- FR-7.4 per-share mark (v0.2)
                  PRIMARY KEY(entry_id, participant_id))
attachments      (id, entry_id FK, trip_id, blob_key, bytes, mime, uploaded_at NOT NULL, deleted_at NULL)

-- audit (append-only)
entry_history    (id, entry_id, trip_id, version, actor, at, diff JSONB)
```

**Constraints that carry the invariants** (FR-9.1):

- I1 as a deferred constraint trigger, checked at commit for every touched
  entry: `Σ shares.amount = amount_minor / 10^exp` and
  `Σ payments.amount_minor = amount_minor`. An entry and its children are always
  written in one transaction, so the check sees the whole picture.
- `CHECK (type <> 'adjustment' OR reason IS NOT NULL)`.
- `CHECK (status <> 'closed')` guard on every write path is done in the
  use-case layer (I5), plus a trigger that rejects ledger writes on closed
  trips as belt-and-braces.
- No `float`/`double precision` column anywhere — a CI check greps the
  migrations.

**Child row order is data.** `payments.ord` and `shares.ord` preserve the
order the client sent, because `roundAll`'s tie-break rotates by position: if
the server returned shares in a different order than the client used, the two
could display different cents for the same entry. Rows are read back by `ord`.

**Testing without Docker.** The persistence suite runs on PGlite (Postgres
compiled to WASM, in-process) by default and on a real Postgres when
`DATABASE_URL` is set; CI does both. Same SQL, same triggers, same deferred
constraints — PGlite is not a mock.

**Why `split_rule` is stored as JSON alongside the materialised shares:** the
shares are what the invariants are checked against and what balances read; the
rule is what the edit screen re-opens and what "same again" duplicates. Storing
both avoids re-deriving the rule from amounts, which is lossy.

**Account deletion (FR-1.9)** is a transaction that: nulls `users.email` and
`display_name`, sets `deleted_at`, deletes `auth_identities`, `sessions`,
`magic_links` for the user, sets `participants.user_id = NULL` and
`tombstoned_at` on every participant it owned, and removes memberships.
Entries, payments, shares are untouched — the ledger stays consistent (I2) and
other members' balances do not move.

---

## 6. API

Hono on Node, deployed as one container. JSON over HTTPS; all money fields are
strings; every request validated against `packages/contracts` zod schemas;
every response typed from the same schemas so the client gets end-to-end types
without a codegen step.

### 6.1 Endpoints (v0.1)

```
auth
  POST /auth/apple                 { identityToken }      → session
  POST /auth/google                { idToken }            → session
  POST /auth/email/request         { email }              → 204 (always, to avoid enumeration)
  POST /auth/email/verify          { token }              → session
  POST /auth/logout
  GET  /me
  DELETE /me                                              → account deletion (FR-1.9)

trips
  GET  /trips                                             → my trips + my balance in each
  POST /trips                      { name, baseCcy, timezone, dates? }
  GET  /trips/:id                                         → trip + participants + memberships
  PATCH /trips/:id                 { name?, dates?, retentionDays? }   (admin)
  POST /trips/:id/transition       { action: 'freeze'|'reopen' }      (admin, FR-8.7)
  POST /trips/:id/invites                                 → { url }   (token shown once)
  DELETE /trips/:id/invites/:id
  POST /invites/:token/accept                             → trip id  (creates membership)
  POST /trips/:id/participants     { displayName }        → placeholder (FR-1.3)
  POST /trips/:id/participants/:pid/claim                 → links to caller (FR-1.11)
  DELETE /trips/:id/participants/:pid                     (zero balance only, FR-1.6)

ledger
  GET  /trips/:id/entries?since=<seq>                     → change feed (§6.3)
  POST /trips/:id/entries          Entry (client id)      → 201, idempotent on id
  PATCH /trips/:id/entries/:eid    Entry  If-Match: <version>  → 200 | 409 conflict (FR-9.5)
  DELETE /trips/:id/entries/:eid   If-Match                → soft delete
  GET  /trips/:id/balances                                → server-computed (cross-check, NFR-12)
  GET  /trips/:id/settlement?plan=bilateral|optimal|hub&hub=<pid>
```

Middleware order: `auth` (Bearer session token → user) → `tripScope`
(`:id` → membership or 404 — never 403, to avoid leaking trip existence) →
handler. The scope middleware is the only place membership is checked, and
every repository method takes `tripId` as its first argument (NFR-14 a, b).

### 6.2 Identity

No managed auth in the core (D3). The three providers reduce to one thing —
*verify a token, get a stable subject*:

```ts
interface IdentityVerifier { verify(provider, token): Promise<{ subject, email? }> }
```

- **Apple / Google**: the app obtains an ID token natively
  (`expo-apple-authentication`, `expo-auth-session`); the server verifies the
  JWT signature against the provider's JWKS, checks `aud`/`iss`/`exp`, and
  reads `sub`. About a hundred lines with `jose`; no SDK.
- **E-mail magic link**: `/auth/email/request` stores a hashed random token
  (15 min TTL) and sends it through the `Notifier` port as a universal link;
  `/auth/email/verify` consumes it. Rate-limited per address and per IP.
- **Sessions**: opaque 256-bit random token, stored as SHA-256 hash, 90-day
  sliding expiry, sent as `Authorization: Bearer`. One row per device.
  Revocable server-side (account deletion kills all of them).
- One user may hold several identities (Apple + e-mail); linking happens by
  verified e-mail match at sign-in or explicitly from the Account screen.

**Invite link flow** (D2, FR-1.2): `https://<domain>/i/<token>` is a universal
link / app link. If the app is not installed it opens the web build; if not
signed in, the token is parked in local storage, the user signs in, and the
accept call fires afterwards. Then "which participant are you?" — claim a
placeholder or create one. The invite token is only ever redeemed *after*
authentication (FR-1.2's "never before").

### 6.3 Change feed and sync

Every ledger write increments `trips.seq` and stamps the written entry with
it. `GET /trips/:id/entries?since=<seq>` returns everything (entries, payments,
shares, participants, trip metadata) with `seq` greater than the cursor,
deletions included as tombstones, plus the new cursor. A per-trip integer
cursor is simpler and more reliable than timestamps (no clock skew, no
same-millisecond ambiguity).

v0.1 collaboration (FR-10.1) is **polling this feed every 10 s while a trip
screen is in the foreground**, and on app resume. It's cheap (an indexed range
scan returning nothing most of the time), it works through every proxy and
network, and it needs no server state. Push-triggered refresh (FR-10.4) and a
server-sent-events variant are drop-in upgrades later; nothing in the client
depends on the transport.

Offline write (FR-11.2, v0.2) becomes: queue the same `POST`/`PATCH` calls in
an outbox with their client-generated IDs and `If-Match` versions, replay on
reconnect, surface 409s as conflicts. The design cost now is exactly two
things — client-generated entry IDs and the `version` column — both present in
v0.1.

**Client side, as built (M6).** The store holds one `TripState` per trip: the
ledger in wire form plus an *outbox* of pending writes. Local mutations apply
immediately and, for shared trips, enqueue an op; `enqueue` folds ops on the
same entry so the server sees one write per entry (edit-after-create stays a
create, delete-after-create cancels both). One sync loop lives in the root
layout: push the outbox in order, then pull the feed to the end; a network
failure leaves everything queued, a 409 turns into a conflict notice with the
server row winning, any other 4xx drops the op and surfaces the message. A
pulled entry never overwrites one with a pending local write. The `local` trip
never syncs and needs no account.

**Delivery is at least once, so writes must be idempotent.** A round can push
an op and lose the response — the write landed, the client still has it queued.
Three rules follow, and each one is a bug we hit rather than a precaution:

- A repeated `POST /participants` with the same client-generated id returns the
  existing row instead of failing on the primary key. Without it the server
  answered 500, and the client dropped a write it had already shown the user.
- A repeated create comes back as a 409 carrying the server's row. When that row
  is byte-for-byte what we sent, it is our own delivery, so the client treats it
  as the missing acknowledgement rather than telling the user that somebody else
  edited an entry only they ever touched.
- A 5xx keeps the op queued and backs the round off. Only a 4xx means "this will
  never be accepted"; dropping a change because the server was briefly broken
  loses data the user believes is saved.

### 6.4 Concurrency

Optimistic: every entry carries `version`; `PATCH`/`DELETE` require
`If-Match`; mismatch → `409` with the current server copy. The client shows
"someone changed this — reload or overwrite" (FR-9.5). No locks, no CRDTs: the
ledger is small and edits to the *same* entry within seconds are rare.

### 6.5 Ports and adapters

```ts
interface Notifier  { sendEmail(to, template, vars); sendPush(deviceTokens, payload) }
interface BlobStore { presignUpload(key, mime, maxBytes); presignDownload(key, ttl); delete(key) }
interface Clock     { today(tz): LocalDate; now(): Instant }
```

v0.1 adapters: SMTP (any relay; Mailpit locally), Expo Push, S3-compatible
(MinIO locally; whichever bucket later). Each adapter is one file; each has a
fake used in tests. Provider SDKs are imported only inside `apps/api/src/adapters/`.

### 6.6 Background jobs

None in v0.1 except the **nightly invariant check** (NFR-12): for every trip,
`Σ balances == 0` and every entry passes I1; alert on any failure. Runs as a
one-shot container command on a schedule, not an in-process cron, so the API
stays stateless. The receipt purge job (FR-12.6, v0.2) uses the same mechanism.

---

## 7. Client (Expo)

- **Routing:** `expo-router` — file-based, and the same routes serve deep links,
  universal links and the web build.
- **Server state:** TanStack Query with a persister into SQLite
  (`expo-sqlite`, which also runs on web via WASM) so the last-fetched ledger is
  available offline (FR-11.1). Cache key per trip; the change feed patches the
  cache rather than refetching everything.
- **Derived state:** balances, outstanding amounts and settlement plans are
  computed from the cached ledger by `packages/domain` in a `useMemo`; never
  fetched for display. The server's `/balances` is used only for the
  reconciliation self-check (FR-9.4).
- **Forms:** amount keypad first (NFR-2's 15-second target hinges on this);
  split editor shows a live `roundAll` preview and the residual indicator; the
  "exact" tab disables Save until the residual is zero (FR-3.6).
- **i18n:** `i18next` + `react-i18next`, `en` as source, `de` shipped;
  `eslint-plugin-i18next/no-literal-string` set to error in `apps/mobile`
  (D10, NFR-8). Number and date formatting via `Intl` with the trip's currency
  and the device locale.
- **Auth storage:** session token in `expo-secure-store` (Keychain / Keystore);
  on web, an HttpOnly cookie set by the API instead.
- **Receipts:** the client asks the API for a presigned PUT, uploads the bytes
  straight to storage and confirms the size; a row with `bytes = 0` is an
  unconfirmed upload that the retention job reaps after a day. With `S3_BUCKET`
  set the bytes go to any S3-compatible bucket; without it the API signs and
  serves them itself, which is enough for a single instance and is what makes
  the whole flow testable without object storage.
- **Offline writes:** entries with an unsent write show a queued badge, the
  overview says "offline" rather than showing a transport error, and failed
  sync rounds back off from 10 s to 5 min (`backoffMs`) so a dead network costs
  one request every few minutes.
- **Builds:** EAS Build with `development`, `preview`
  (TestFlight / internal testing) and `production` profiles; EAS Update for
  over-the-air JS fixes on the preview channel during the trip (mitigates the
  review-latency risk).

---

## 8. Cross-cutting

**Security (NFR-5).** Invite, magic-link and session tokens are random
256-bit values stored only as SHA-256 hashes. Invite links expire (7 days) and
are revocable. Trip-scoped 404s, never 403s. Presigned upload URLs carry a
size and MIME limit. Rate limits on all `/auth/*` endpoints. Row-level access is
in one middleware and every repo method is trip-keyed, so a missing check is a
type error rather than a runtime leak.

**Privacy (NFR-6).** Personal data is confined to `users` and
`auth_identities`; deleting an account empties both without touching the
ledger. Data export (`GET /me/export`) is a JSON of the user's trips as seen by
them. Receipts are private objects behind short-lived presigned URLs.

**Observability (NFR-12).** Structured JSON logs with `trip_id` and request ID;
error tracking behind a tiny `ErrorReporter` port (Sentry is fine as the
adapter — it is an edge, not the core); the nightly invariant job.

**CI (`ci.yml`).** On every push: lint (including the import-boundary and
no-literal-string rules), typecheck, domain property tests, API integration
tests against a real Postgres (testcontainers), a grep that fails on any
`float`/`double` in migrations, and an EAS preview build on `main`.

---

## 9. Decisions (ADR summary)

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| A1 | `bigint` fixed-point for both money types | `decimal.js` / `big.js`; Postgres-only arithmetic | Exact, zero dependencies, identical on client and server, trivially serialisable; a decimal lib adds a dependency for no gain at 8 dp |
| A2 | Own identity layer on OIDC verification + magic links | Supabase Auth, Clerk, Auth0, Firebase | D3 forbids managed auth in the core; verifying ID tokens is ~100 lines; the stores' rules (deletion, Apple parity) are easier to satisfy when we own the flow |
| A3 | Hono on Node (confirmed by the owner at M5) | Fastify, Express, NestJS, tRPC | Small, standards-based (Web Request/Response), runs unchanged on Node, Bun or edge runtimes — keeps D3 honest; zod contracts give tRPC-like typing without its coupling |
| A4 | Drizzle in a separate `persistence` package | Prisma; raw SQL | Thin, SQL-shaped, migrations are plain SQL we can read; isolated so the domain never sees it. Prisma's engine binary complicates portable containers |
| A5 | Polling a per-trip sequence for live updates | WebSockets, SSE, Firebase-style realtime | Stateless API, works everywhere, adequate for a 5-person ledger; transport is invisible to the client and upgradable |
| A6 | Domain runs on the client too | Server computes everything | Offline read, instant balance updates, and one implementation of the money rules instead of two |
| A7 | Client-generated UUIDv7 entry IDs + `version` now | Server IDs, add later | The entire cost of offline-write later is these two columns |
| A8 | Materialised shares + stored split rule | Store only the rule and recompute; store only shares | Invariants check materialised numbers; the rule keeps edits and "same again" lossless |
| A9 | Exact settlement search up to n = 16 | Greedy only; ILP solver | O(2ⁿ·n) is ~1 M steps at 16 — milliseconds; greedy is demonstrably not minimal; an ILP dependency is absurd at this size |
| A10 | Expo + EAS | Bare React Native; Flutter; Capacitor | One TS codebase incl. web (D1), OTA updates for mid-trip fixes, store builds without a Mac in the loop |

**Deliberately not decided here** (per the requirements' deferrals): the host
(D3), the notification providers (D16), the test-distribution channel (D15),
and what the paid tier gates (D13). Each has a seam above where it plugs in.

---

## 10. Build order for v0.1

Each milestone has a "done when" that is checkable, and the order is chosen so
the riskiest, most reused code (the domain) is proven first and the UI is
built on a working API rather than mocks.

| # | Milestone | Depends on | Done when |
|---|---|---|---|
| M0 | **Scaffold** — monorepo, packages, ESLint boundary rules, CI skeleton, docker-compose | — | `pnpm lint typecheck test` green on an empty repo; a domain import of `hono` fails lint |
| M1 | **Domain: money + split** — `Money`, `Precise`, `roundAll`, `allocate`, serialisation | M0 | Property suite for I1, P4, P5, round-trips passes; `€55.18 / 5` case is a named test |
| M2 | **Domain: ledger + settlement + lifecycle** — `balances`, `tripCost`, `settle` ×3, `transition`, `Entitlements` | M1 | I2 property passes; optimal ≤ greedy on 10 k random trips; `[+2,+3,−4,−5,+4]` → 3; exact n=16 < 50 ms |
| M3 | **Schema + persistence** — migration 0001 with every column from §5, deferred I1 constraint, repositories, seed script | M0 | Integration tests: an entry whose shares don't sum is rejected at commit; a ledger write on a closed trip is rejected; no float column (CI grep) |
| M4 | **Identity** — Apple/Google verification, magic link, sessions, `/me`, account deletion | M3, Notifier port | Sign in with all three; deletion leaves another member's balance unchanged (integration test) |
| M5 | **API: trips + ledger + feed** — endpoints of §6.1, trip-scope middleware, `If-Match`, change feed | M2, M3, M4 | Two clients polling the feed converge on the same balances; 409 on stale version; cross-trip access is a 404 |
| M6 | **Client shell** — Expo app, routing, sign-in, invite acceptance, participant claim, trip list, i18n wiring with `en`+`de` | M4, M5 | Fresh phone → invite link → signed in → claimed a placeholder in under 3 min (G5), on both platforms and web |
| M7 | **Add / edit expense** — keypad-first form, split editor with live preview and residual, payers, transfers | M6 | Median time to log an equal split ≤ 15 s (G3) across five test users; exact split cannot be saved with a residual |
| M8 | **Balances + settle up** — home balance headline, per-person list, ledger, settlement plan (3 kinds), "mark paid" → transfer, freeze/reopen | M7 | Plan applied via "mark paid" drives all balances to zero; UI shows who absorbed the residual |
| M9 | **Offline read + entitlement seams + retention metadata + nightly invariant job** | M8 | Ledger visible in airplane mode; `check()` called on upload/create paths; job alerts on a deliberately corrupted row |
| M10 | **Distribution** — EAS profiles, store-compliance items (privacy forms, deletion, SIWA), channel per D15 | M9 | The five of you have it installed; an OTA fix reaches them without a store review |
| M11 | **The trip** | M10 | One real vacation run end to end with no spreadsheet (G1) — the exit criterion |

M1–M2 and M3–M4 are independent and can run in parallel; M5 joins them. Nothing
in M6–M8 should start against mocked endpoints — the API is small enough to be
real by then, and the feed/conflict behaviour is where mocks would lie.

---

## 11. Architecture-specific risks

| Risk | Mitigation |
|---|---|
| The domain package quietly grows an import it shouldn't | ESLint boundary rule is an *error*, and CI runs it; reviewed as a hard rule |
| Someone rounds a `Precise` in a component for display | The only rounding function takes the whole share set and the total; a single-value `round(precise)` does not exist |
| Apple/Google token verification drifts (key rotation, `aud` changes) | JWKS fetched with caching + retry; integration test against recorded tokens; the failure mode is "can't sign in", never "wrong user" |
| Polling feels laggy or wasteful | 10 s foreground interval with backoff; measured, then upgraded to push-triggered refresh if it matters |
| `expo-sqlite` on web is immature for the persister | Fallback persister to IndexedDB behind the same interface; test both in CI |
| Deferred constraint triggers are easy to get subtly wrong | Property tests drive random ledgers through the real database in M3, not just the domain |
