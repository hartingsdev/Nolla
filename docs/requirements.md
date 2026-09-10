# Vacation Spending Tracker — Requirements

Status: **Draft v1.6** · Owner: project team · Date: 2026-09-10

**Changelog**

- v1.6 — cost note added to §1.3: storage is not the cost driver, which removes
  the stated rationale for gating on it (D11, D13); Q15 restated as deliberately
  open until after the first real trip. Q11b split: the mail half is a credential needed before v0.1 ships
  (Q11c), not a v0.3 provider choice; only push stays deferred.
- v1.5 — P4 tightened to truncate-then-largest-remainder after a UI test
  surfaced a phantom one-cent transfer following full settlement.
- v1.4 — exact settlement search raised to n ≤ 16 with the O(2ⁿ·n) DP
  documented in [architecture.md](architecture.md) §4.4.
- v1.3 — review pass: explicit `Participant` entity (placeholders, claiming,
  tombstoning); adjustments made two-sided so Σ balances == 0 holds; settlement
  spec corrected (greedy is not always minimal — exact search for small n);
  trip lifecycle `open → settling → closed` defined; FR-3.6 acceptance aligned
  with the precision model; `trip_id` used consistently.
- v1.2 — both stores at launch; English source with German shipped in v0.1;
  receipt retention per trip (12-month default, purge deferred); paid tiers as
  an axis-agnostic entitlement model; D13, D15, D16 explicitly deferred.
- v1.1 — native app-store distribution instead of a PWA; accounts required up
  front; multi-tenant schema; hosting deferred behind portability constraints;
  sheet import and fixture dropped; two-tier money precision (§5.1).
- v1.0 — initial requirements derived from the spreadsheet.

See §1.3 for the decision log.

This document does the requirements engineering for a group travel expense
tracker that replaces the spreadsheet the group currently maintains. It defines
scope, the domain model, functional and non-functional requirements, the
settlement algorithm, and a release plan.

---

## 1. Problem statement & vision

A group of friends (currently 5: Yannik, Max, Robert, Tobias, Marc) shares costs
during vacations. Whoever has the card pays; the cost is split among whoever
benefited; at the end everybody settles up. Today this is a Google Sheet with a
`Preis` column, one column per person, an "an wen?" (to whom) column, a totals
block, and a hand-built debt matrix.

**Vision:** a shared app where any participant can add an expense in under 15
seconds from their phone during the trip, sees at all times what they owe and to
whom, and gets a provably correct, minimal set of transfers at the end — with no
manual arithmetic and no reconciliation drift.

### 1.1 Goals

| # | Goal | Success measure |
|---|------|-----------------|
| G1 | Replace the spreadsheet entirely for the next trip | 100% of expenses entered in the app; no parallel sheet |
| G2 | Eliminate arithmetic and reconciliation errors | Sum of shares == expense total, always, by construction |
| G3 | Fast capture in the field | Median time to log an equal-split expense ≤ 15 s, offline-capable |
| G4 | Trustworthy settlement | Every member can trace any balance back to the expenses that produced it |
| G5 | Low friction to join | Install → sign in → logging in ≤ 3 min; a member who hasn't installed yet can still be split against via a placeholder participant |

### 1.2 Non-goals (explicitly out of scope for v1)

- Moving money **between members** (no PSP/banking integration; we only *link
  out* to PayPal.me / generate SEPA payment data). The app's own future
  subscription (FR-12.7) is a separate matter and goes through the stores.
- Bank/credit-card statement import.
- Budgeting, forecasting or savings goals.
- Trip planning: itineraries, bookings, packing lists.
- Public/social features, feeds, or sharing outside the group.
- Public-launch scaffolding — onboarding tour, marketing site, billing, support
  desk, analytics. Deferred (§1.3 D5), but deliberately *not designed out*.

---

### 1.3 Decision log

Resolved 2026-09-08. These supersede the open questions in the v1.0 draft.

| # | Decision | Rationale | Consequences |
|---|---|---|---|
| D1 | **Native app, published to the App Store and Play Store** — React Native (Expo), one TypeScript codebase, with the web build shipped alongside | The owner wants store distribution and sees a possible product for others | Two developer accounts (Apple $99/yr, Google $25 once), release review cycles, store compliance work (NFR-15); the web build stays the zero-install path for someone joining mid-trip |
| D2 | **Account required up front** — Sign in with Apple / Google / e-mail, before joining a trip | Clean identity, cross-device from day one, simplest support and audit story as a product | A signup wall during a trip; mitigated by placeholder participants (FR-1.3), which become load-bearing rather than a convenience. Apple: offering Google sign-in obliges Sign in with Apple (FR-1.10); having accounts obliges in-app deletion (FR-1.9) |
| D3 | **Hosting deferred, portability enforced** | "Scalable, decide later" | Three binding constraints (NFR-14): `trip_id` on every row, no query spanning trips, domain logic free of framework and vendor imports. No managed-auth or managed-storage shortcuts in the core |
| D4 | **Single currency in the MVP, multi-currency later** | The sheet is entirely EUR | `currency` and `fx_rate` columns exist from the first migration, unused in v0.1 — a feature flag later, not a migration (FR-2.8) |
| D5 | **Build for this group; don't foreclose the product** | Ship for the next trip, keep the door open | Multi-tenant schema, no hardcoded participants, pure domain module — roughly 10% over a single-group build. Product scaffolding deferred per §1.2 |
| D6 | **In scope**: per-share paid status (FR-7.4), per-person tip (FR-3.7), preferred-creditor routing (FR-8.5) | All three reflect real group behaviour | As specified, v0.2 |
| D7 | **Sheet import and the golden fixture both dropped** | Neither the importer nor a transcribed test fixture is wanted | No import UI, no spreadsheet-derived test data. Correctness rests on property-based tests over the invariants (NFR-11, NFR-13) |
| D8 | **Two-tier money precision** — high-precision derived values, integer minor units for anything payable | Rounding per expense lets one member absorb the odd cent repeatedly; keeping shares exact removes that drift entirely | Shares and balances are exact to 8 decimal places; rounding happens at exactly two boundaries, display and settlement (§5.1). Replaces the earlier "integer cents everywhere" rule |
| D9 | **Both stores at launch** (Q9) | Expo builds both from one source; the group is mixed iOS/Android, so shipping one first excludes friends from the trip the app was built for | Two developer accounts, two review queues, two listings. Development effort roughly unchanged |
| D10 | **English source strings, German shipped from v0.1** (Q14) | The group is German-speaking, but a product needs an English source; retrofitting i18n means extracting every hardcoded string | i18n plumbing and one translation pass in v0.1 (~1 day). Locale-aware formatting regardless (NFR-8) |
| D11 | **Receipt retention configurable per trip, default 12 months; purge job deferred to v0.2** (Q12) | ~~Storage is the real cost driver~~ — see the note below; retention is a per-trip lever either way | The *metadata* is mandatory from day one: a retention setting on every trip and `uploaded_at` on every receipt, so the purge job ships later with no backfill (FR-12.4). **The purge job shipped in v0.2**, so the unbounded-growth risk this decision accepted is closed |
| D12 | **Paid tiers planned; billing deferred** (Q13) | The owner intends to recover running costs, ~~most likely for storage~~ (see the cost note in §1.3), but demand is unproven | v0.1 builds the entitlement model only: a plan on each account, every limit check routed through one service (FR-12.1–12.3). No billing, no in-app purchase, no paywall UI. Apple and Google require digital subscriptions to go through IAP at a 15–30% cut — that shapes pricing whenever it happens, and is why no Stripe-style flow can live in the app |
| D13 | **Deferred: what the paid tier gates** (Q15) | Owner will decide after a real trip; the storage premise turned out not to hold (note below) | Forces the entitlement model to be *axis-agnostic*: a plan carries a set of named limits, and no limit is special-cased in the domain. Costs a little indirection, buys the freedom to pick the axis later. `receipts.perTrip` and `receipts.bytesPerTrip` stay, but as **abuse guards, not price levers** |
| D14 | **v0.1 ships through a non-public channel** (Q10) | Whether TestFlight/internal testing or sideloaded dev builds is undecided, but neither needs a public listing | The store listing, screenshots and marketing assets stay out of v0.1 either way. FR-1.9, FR-1.10 and the privacy forms are still built in v0.1, since they gate the eventual listing and are expensive to retrofit |
| D15 | **Deferred: the specific test-distribution channel** (Q10) | Undecided | Decide before v0.1 ships. TestFlight needs a paid Apple account and light review; free-account sideloading expires every 7 days and needs re-signing per device |
| D16 | **E-mail and push behind a `Notifier` port** (Q11) | Portability (D3); volume is unknown | v0.1 wires a throwaway implementation (Expo push, any SMTP for magic links). The core depends on the port, never a vendor SDK (NFR-14). Swapping later is one adapter |

**Scale path implied by D3** (the shape this category of app takes): stateless API
behind a load balancer → managed Postgres → object storage with signed URLs for
receipts → CDN for the app shell → APNs/FCM for push. Data partitions perfectly
by trip — no cross-user queries, no feed, no global joins — so the path is
vertical Postgres → read replicas → partition by `trip_id`, and sharding stays
theoretical at this size. The cost driver at scale is receipt images and push,
not ledger rows.

> **Note on cost, added 2026-09-10 (v1.6).** D11 and D12 both assume storage is
> the cost driver. The numbers do not support it. A receipt is a JPEG at quality
> 0.6, capped at 8 MiB (`RECEIPT_MAX_BYTES`); realistically 300–500 KB. A week
> with five people and a receipt on half of ~40 expenses is **~8 MB per trip**,
> kept 12 months — roughly **0.2 cents a year** at object-storage prices. The
> abuse case, 8 MiB on every entry, reaches ~320 MB and about eight cents.
>
> What actually costs money is **fixed, not marginal**: the API host, the
> database, and the Apple Developer Program at 99 USD a year. Those are paid
> whether there is one group or five hundred.
>
> Two consequences. Gating on storage volume or retention would restrict what is
> nearly free, degrading receipts — the feature that makes the app pleasant — to
> protect nothing. And the cheapest route to covering costs is a smaller fixed
> floor (one small host, Android first) rather than any pricing scheme.
>
> Prices are estimates from public list rates, not quotes; the order of magnitude
> is what matters here.

## 2. Stakeholders & personas

| Stakeholder | Interest |
|---|---|
| **Participant** (all 5 friends) | Log spend fast, know their own balance, pay the right amount at the end |
| **Trip organizer** (currently Robert — fronts rent, fuel, tolls) | Get reimbursed, keep the ledger correct, correct other people's mistakes |
| **Treasurer / spreadsheet owner** (currently whoever owns the sheet) | Close the trip, produce the final settlement, record who has already paid |
| **Operator** (us) | Cheap to host, low maintenance, no personal-finance regulatory burden |

Personas:

- **"Payer" Robert** — puts €465 rent and most fuel on his card. Needs: see total
  outstanding receivables, mark incoming payments as received.
- **"Casual" Max** — pays for a round of drinks now and then, sometimes skips an
  activity. Needs: one-tap "I wasn't part of this", clear "what do I owe".
- **"Auditor" Yannik** — the one who checks the sheet. Needs: full history, an
  audit trail of edits, and reconciliation guarantees.

---

## 3. Glossary

| Term | Definition |
|---|---|
| **Trip** | A container for participants, a currency, and a ledger of entries. The tenant of the system: every row carries its `trip_id`. |
| **Participant** | A person *in a trip* — the thing shares and payments point at. Linked to a User once claimed; a **placeholder** until then; **tombstoned** (name kept, identity detached) if the user deletes their account. |
| **Entry** | Any line in the ledger. One of: Expense, Reimbursement, Transfer, Adjustment. |
| **Expense** | Money that left the group, paid by one (or more) participants, split among beneficiaries. |
| **Payer** | Participant(s) who actually paid the merchant. The sheet's `an wen?` column. |
| **Share** | The portion of an entry attributed to one beneficiary. |
| **Split rule** | How the total is divided: equal, shares/weights, percentage, exact amounts, or per-item. |
| **Reimbursement** | Money that came *into* the group and reduces cost (bottle deposit `Pfandsammlung`, cashback, refund). Modeled as a negative expense. |
| **Transfer** | A payment from one participant directly to another (the sheet's `Zahlung` rows). Settles debt; is *not* a trip cost. |
| **Adjustment** | A manual correction booked against a participant's balance, with mandatory reason (the sheet's `Umbuchung`). |
| **Balance** | For a participant: Σ payments − Σ shares across every entry type (expenses, reimbursements, transfers, adjustments). Positive = is owed money (creditor). Held as `Precise`. |
| **Residual** | The sub-cent difference that appears when a `Precise` value is rounded to `Money`. Always attributed to a named participant, never dropped (§5.1 P4). |
| **Plan / entitlement** | The set of named limits an account is entitled to; resolved per trip through one service (FR-12). v0.1 has a single all-permitting plan. |
| **Gross debt matrix** | Who owes whom before netting (sheet rows 42–46). |
| **Settlement plan** | The list of transfers that brings all balances to zero (sheet rows 49–53). |
| **Bilateral netting** | Cancelling debts only between pairs: A owes B €21.88, B owes A €11.75 → A pays B €10.13. |
| **Optimal settlement** | The minimum number of transfers that clears all balances group-wide. |
| **Settling** | Trip state after the plan is frozen: no new expenses, transfers still being recorded against the plan. |
| **Closed** | Trip state once every balance is zero at `Money` precision; read-only. |

---

## 4. As-is analysis: what the spreadsheet already does

Everything the sheet does is a requirement until proven otherwise. Derived from
the two screenshots:

| # | Observed behaviour in the sheet | Evidence | Requirement |
|---|---|---|---|
| A1 | Expense with a total price and one column per person | `Miete 1/2` €465.35 → 5 × €93.07 | FR-3.1 |
| A2 | Equal split is the default | most rows | FR-3.2 |
| A3 | Split across a **subset** of participants | `Rulantica` €168.00 → €42.00 × 4, Marc excluded | FR-3.3 |
| A4 | **Unequal, per-person amounts** | `Casamore` €120 → 29.45 / 32.45 / 36.12 / 21.95; `Essen Saarbrücken` → 11.75 / 7.50 / 19.75 | FR-3.4 |
| A5 | The payer is recorded per row | `an wen?` = an Robert / an Marc / an Tobias / an Yannik / an Max | FR-2.3 |
| A6 | **Negative entries** for money coming back | `Pfandsammlung` −€8.75, `Cashback Marc` −€60.50 | FR-4 |
| A7 | Zero-amount placeholder rows | `Essen Flammkuchen` €0.00 | FR-2.6 |
| A8 | **Payments between members** logged in the same ledger | `Zahlung` €50.00 Robert → Max; `Zahlung` €4.00 Robert → Marc | FR-5 |
| A9 | Manual correction rows | `Umbuchung für die Gesamtzeile` −€70.00 | FR-6 |
| A10 | Per-person totals and a grand total | row `Gesamt` €1,987.45 | FR-7.1 |
| A11 | "Already paid" tracked with an as-of date | `Bereits gezahlte Kosten (Stand: 06.03)` | FR-7.2 |
| A12 | Outstanding = total − already paid | row `Offen` | FR-7.3 |
| A13 | A gross who-owes-whom matrix | rows 42–46, one row per creditor, `///` on the diagonal | FR-8.1 |
| A14 | A netted matrix of what to actually transfer, colour-coded | rows 49–53 + `Summe` row, green = to be paid | FR-8.2 |
| A15 | A per-person tip column | `Trinkgeld p.P.` (unused so far) | FR-3.7 |
| A16 | Colour marks confirmed/paid cells | green cells in `Miete` rows and the settlement block | FR-7.4 |

### 4.1 Pain points found in the actual data (these justify the build)

These are real defects present in the current sheet — the app must make them
impossible, not merely easier to spot:

1. **Shares don't reconcile to the total.** `Essen Saarbrücken`: 11.75 + 7.50 +
   19.75 = **€39.00** but the price says **€38.95** (over by 5 ct). `Casamore`:
   29.45 + 32.45 + 36.12 + 21.95 = **€119.97** vs **€120.00** (under by 3 ct).
   → *The app must guarantee Σ shares == total by construction (FR-3.6, §5.1).*
2. **Rounding drift on equal splits.** €55.18 / 5 = €11.036, stored as €11.04 ×
   5 = €55.20. Cents are invented, and the same member can absorb the odd cent
   on every expense — €0.10 of spread over ten such rows.
   → *Store the share exactly and round only at the payment boundary (§5.1).*
3. **The totals row needed a manual fudge.** Per-person totals sum to €1,917.45
   against a grand total of €1,987.45; the gap is patched by an
   `Umbuchung für die Gesamtzeile` of −€70.00 booked on one person.
   → *Adjustments must be first-class, reason-bearing entries, never a hack to
   force a total (FR-6); the invariant in FR-9.1 must hold continuously.*
4. **Debt matrix is hand-maintained** and only bilaterally netted, so more
   transfers happen than necessary.
   → *Derived, never typed; optimal settlement offered (FR-8.3).*
5. **No audit trail.** Who changed a number, and when, is unknowable.
   → *FR-10.*
6. **Single-writer bottleneck.** One person owns the sheet, everyone else sends
   them WhatsApp messages during the trip.
   → *Multi-user real-time ledger (FR-1).*
7. **No receipts.** Disputes are settled from memory.
   → *FR-2.5.*

---

## 5. Domain model

```
User ──< Membership >── Trip ──< Participant
 │                       │            ▲  (shares and payments point here,
 └─ Plan                 │            │   never at User or Membership)
                         ├──< Entry ──┼─< Share       (participant, Precise amount)
                         │            ├─< Payment     (participant, Money amount)
                         │            └─< Attachment  (uploaded_at)
                         ├─ base currency, timezone, retention setting
                         └─ SettlementPlan  (derived on demand, never stored)
```

**Entities**

- **User** — identity (Sign in with Apple / Google / e-mail), display name,
  `plan` (FR-12). Deleting a User (FR-1.9) detaches it from its Participants;
  it never deletes trip data.
- **Trip** — the tenant. Name, base currency, timezone, date range, status
  (`open` | `settling` | `closed`), retention setting (FR-12.4), created_by.
- **Membership** — user ↔ trip, role (`member` | `admin`). Access control only;
  money never points at a Membership.
- **Participant** — a person *as they appear in one trip*: display name,
  `user_id` (nullable — null means a **placeholder**, FR-1.3), `joined_at`,
  `left_at`, `tombstoned_at`. Shares and Payments reference Participants, which
  is what lets a placeholder be split against before they sign up, be claimed
  later with all history following (FR-1.11), and survive the user's account
  deletion (FR-1.9).
- **Entry** — `type` ∈ {`expense`, `transfer`, `adjustment`}, description,
  `amount` (`Money`, signed — negative for reimbursements), `currency` +
  `fx_rate` to base (D4), `date` (a calendar date in the trip's timezone, not a
  timestamp), category, note, `reason` (mandatory for adjustments),
  created_by, created_at, deleted_at, version.
- **Payment** — (entry, participant, amount: `Money`) — who put the money down.
  More than one per expense is allowed (FR-2.3).
- **Share** — (entry, participant, amount: `Precise`, weight?) — who owes what.
- **Attachment** — receipt image/PDF bound to an entry; `uploaded_at` (FR-12.4).

**One shape for every entry type.** Expenses, transfers and adjustments are all
"payments in, shares out": a transfer A → B is a Payment by A and a Share to B; an
adjustment is the same with a mandatory reason (FR-6.1). Only `expense` entries
count toward trip cost. This is what makes the invariants below hold
universally rather than per type.

**Invariants** (see FR-9):

- I1: for every entry, `Σ shares == Σ payments == entry.amount`, evaluated at
  `Precise` precision (shares are `Precise`; payments and the total are `Money`)
- I2: for every trip, `Σ over participants of balance == 0` — follows from I1
  because every entry type has the same shape
- I3: money follows the two-tier precision model of §5.1 — derived values exact
  to 8 dp, payable values as signed integers in minor units; no binary floats
  anywhere, in storage, transport or arithmetic
- I4: `transfer` and `adjustment` entries contribute €0 to trip cost; only
  `expense` entries do
- I5: a `closed` trip has every balance at zero at `Money` precision, and
  accepts no writes

---

### 5.1 Money and precision model (D8)

The sheet's rounding defects (§4.1) come from rounding **every expense** to
cents. €55.18 split five ways is €11.036 per person; forcing that to €11.04
invents money, and whoever absorbs the odd cent absorbs it again on the next
expense. Ten such expenses put a **€0.10 spread** between the luckiest and
unluckiest member.

The fix is to stop rounding early. Two representations, with a hard rule about
which is used where:

| Tier | Type | Representation | Used for |
|---|---|---|---|
| **Payable** | `Money` | signed integer, minor units (cents) | Entry totals as entered, merchant payments, transfers between members, settlement-plan amounts, per-share settled marks (FR-7.4) |
| **Derived** | `Precise` | fixed-point decimal, 8 fractional digits, stored as a scaled integer or `DECIMAL(20,8)` | Computed shares, running balances, weight and percentage maths, FX conversion (FR-2.8) |

**Rules**

- **P1** — Anything one human hands to another is `Money`. That rounding is
  physical, not a storage choice: a transfer is an integer number of cents.
- **P2** — Anything the system derives is `Precise` and is never rounded in
  storage or in intermediate arithmetic.
- **P3** — Rounding happens at exactly two boundaries: **display** and
  **settlement-plan generation**. Nowhere else.
- **P4** — At each boundary, truncate every value toward zero, then hand the
  residual units to the entries with the largest discarded remainder, so the
  rounded set sums exactly to the total. Truncating (not nearest, not floor) is
  what keeps P7 true: a vector of sub-unit leftovers rounds to all zeros, so no
  phantom cent is ever proposed after everyone has paid. The residual is
  assigned deterministically and shown, never silently dropped.
- **P5** — 8 dp is not exact for every split (100 ÷ 3 = 33.33333333 × 3 =
  99.99999999). The residual is 10⁻⁸ instead of a cent, and P4 still applies. If
  bit-exactness is ever required, the fallback is to store the split *rule*
  (weights) and evaluate with rational arithmetic — deferred, not needed at this
  scale.
- **P6** — Binary floating point is banned in storage, transport (JSON numbers
  included — money crosses the wire as strings or scaled integers) and
  arithmetic.
- **P7** — Marking one share settled (FR-7.4) records a `Money` payment against a
  `Precise` share, so the two rarely match exactly: paying the displayed €11.04
  against a share of €11.036 leaves +€0.004 on that member's balance. That
  fraction is *correct* and stays in the balance, where final settlement nets it
  away. The UI shows such a share as settled, not as "€0.004 outstanding" — a
  residual below one minor unit is never surfaced as a debt.

**What this buys, on your own data:** €55.18 split five ways, ten times, leaves
every member owing exactly €110.36 with a spread of €0.00, against €0.10 under
per-expense rounding.

**What it does not buy:** a balance of €110.364 is still paid as €110.36. The
last 0.4 cents is assigned by P4 at the settlement boundary. Precision removes
drift; it cannot make money continuous.

---

## 6. Functional requirements

Priority uses MoSCoW: **M** = must (MVP), **S** = should (v1), **C** = could
(later), **W** = won't (this release).

### FR-1 Trips, members, access

| ID | Priority | Requirement |
|---|---|---|
| FR-1.1 | M | Create a trip with name, base currency, optional start/end date. |
| FR-1.2 | M | Invite members via a share link. Opening it requires an account: Sign in with Apple, Google, or e-mail magic link (D2). The link resolves to the trip after sign-in, never before. |
| FR-1.3 | M | Add a **placeholder participant** (name only, no account) so someone who hasn't installed or signed in can still be split against. Claimed later per FR-1.11. |
| FR-1.4 | S | Roles: any member can add/edit entries; only admins can delete members, close the trip, or edit a closed trip. |
| FR-1.5 | S | A member who joins on day 3 is excluded by default from earlier expenses (`joined_at`). |
| FR-1.6 | S | Remove a participant from a trip only if they hold a zero balance; otherwise require settlement first. (Distinct from account deletion, FR-1.9, which never removes a participant — it detaches the user and leaves the participant tombstoned.) |
| FR-1.7 | C | Multiple trips per user, with an archive view. |
| FR-1.8 | C | Sub-groups within a trip ("the 3 who did Rulantica") as reusable split presets. |
| FR-1.9 | M | **In-app account deletion** that removes the account and its personal data, per App Store guideline 5.1.1(v). Deleting an account with a non-zero balance must not corrupt other members' ledgers: the participant is tombstoned (display name retained, identity detached) and the trip's entries stay intact. |
| FR-1.10 | M | **Sign in with Apple** offered wherever Google sign-in is offered, per Apple's equivalent-option rule. |
| FR-1.11 | S | Placeholder participants (FR-1.3) are promoted to real members by claiming them after sign-in; all their historical shares follow the claim. |
| FR-1.12 | S | A participant's **display name can be corrected**: by the person themselves (including when they join and claim a placeholder someone else named), or by a trip admin. Every previous name is kept and shown, because in a shared trip a name is how everyone else recognises whose money an entry is — a silent change rewrites the past for them. Names are labels: the ledger references participant ids, so a rename never moves money, and it is allowed whatever the trip's status. |

**Acceptance (FR-1.2):** opening the share link on a fresh phone leads to
sign-in, then to the trip, then to claiming a participant slot — with the whole
path completable in under three minutes on mobile data (G5). Someone who has not
yet installed the app is still splittable against as a placeholder (FR-1.3), so
the signup wall never blocks *other people's* expense entry.

### FR-2 Recording an expense

| ID | Priority | Requirement |
|---|---|---|
| FR-2.1 | M | Add expense: description, amount, date (defaults to now), payer (defaults to me), split rule. |
| FR-2.2 | M | Edit and soft-delete any entry; deletions are reversible and visible in history. |
| FR-2.3 | M | Payer selectable from participants; **multiple payers** with explicit amounts (replaces `an wen?`). |
| FR-2.4 | S | Category with icon (rent, groceries, fuel, tolls, parking, restaurant, activity, other) — derived from the sheet's actual rows. |
| FR-2.5 | S | Attach one or more receipt photos, camera-first on mobile. Client-side compression before upload; every receipt records `uploaded_at` for retention (FR-12.4). |
| FR-2.6 | S | Allow a €0.00 entry as a placeholder to be filled in later; flag it as incomplete. |
| FR-2.7 | S | Duplicate an entry ("same again"), and templates for recurring costs (fuel, tolls). |
| FR-2.8 | C | Multi-currency: enter in local currency, store FX rate to base, show both. |
| FR-2.9 | C | OCR the receipt total, and per-item parsing for itemized splits. |
| FR-2.10 | C | Recurring/instalment expense (`Miete 1/2`, `Miete 2/2` with due dates 18.11.2025 / 08.02.2026). |

### FR-3 Splitting

| ID | Priority | Requirement |
|---|---|---|
| FR-3.1 | M | Split among a selectable subset of participants (default: every participant present at the entry's date, placeholders included). |
| FR-3.2 | M | **Equal** split. |
| FR-3.3 | M | Include/exclude toggle per participant, one tap each. |
| FR-3.4 | M | **Exact amounts** per participant (covers `Casamore`, `Essen Saarbrücken`). |
| FR-3.5 | S | **Weights/shares** (e.g. 2:1:1) and **percentages**. *Shipped in the entry form, and the rule is stored with the entry, so reopening restores it and an edit re-applies it to the new total.* |
| FR-3.6 | M | Guarantee Σ shares == total. On equal/weight/percentage splits, shares are computed and stored as `Precise` (§5.1) so they sum to the total exactly with no cent to allocate; the €11.036 case is stored as €11.036. On exact-amount splits the shares are `Money` typed by a human, so saving is blocked until the residual is €0.00, offering "assign remainder to …". Display rounds per P3/P4 and shows the rounded shares summing to the total. |
| FR-3.7 | S | Per-person surcharge line on an entry — **tip** (`Trinkgeld p.P.`), service charge, deposit — added on top of the split base. *Confirmed in scope (D6). Shipped as one tip per person, carved out of the entry total before the rule divides the rest, and stored with the entry so an edit cannot silently redistribute it; a per-person differing surcharge is still open.* |
| FR-3.8 | S | Remember the last split configuration per trip and per category as the default. |
| FR-3.9 | C | Itemized split: enter line items, assign each to people, tip/tax distributed proportionally. |
| FR-3.10 | C | Named split presets ("everyone but Marc"). |

**Acceptance (FR-3.6):** €55.18 split equally among 5 stores five shares of
exactly €11.036 (`Precise`), whose sum is exactly €55.18; the display rounds them
per P4 to 11.04 / 11.04 / 11.04 / 11.03 / 11.03, which also sum to €55.18, with
the two members who show €11.03 chosen deterministically. No UI path can persist
an entry whose shares do not sum to its total.

### FR-4 Reimbursements and negative amounts

| ID | Priority | Requirement |
|---|---|---|
| FR-4.1 | M | Negative expense (income to the group): bottle deposit refund, cashback, partial refund, discount. Split by the same rules. |
| FR-4.2 | S | Link a refund to its original expense so the pair can be shown together. |
| FR-4.3 | S | Reports must show negative entries distinctly and not treat them as spend. |

### FR-5 Transfers between members

| ID | Priority | Requirement |
|---|---|---|
| FR-5.1 | M | Record a payment from participant A to participant B with amount and date (the `Zahlung` rows). It changes balances but adds €0 to trip cost. |
| FR-5.2 | M | Transfers appear in the ledger, filterable and separable from expenses. |
| FR-5.3 | S | A recorded transfer counts toward balances immediately (as the sheet's `Zahlung` rows do). The recipient is notified and can **dispute** it; a disputed transfer stays in the balance but is flagged on both members' views until resolved or deleted. *Shipped: recipient-only, enforced server-side; flagged in the ledger, on the overview and on the entry; withdrawn by the person who raised it. The notification itself waits for push (FR-10.4) — until then it surfaces on next sync.* |
| FR-5.4 | S | One-tap "settle up" that pre-fills a transfer from the settlement plan. |
| FR-5.5 | C | Deep-link to PayPal.me / generate SEPA QR (EPC) or a copyable IBAN block for the recipient. |
| FR-5.6 | W | Executing the payment inside the app. |

### FR-6 Adjustments

| ID | Priority | Requirement |
|---|---|---|
| FR-6.1 | S | Book a manual adjustment with a **mandatory reason** (replaces `Umbuchung für die Gesamtzeile`). An adjustment is always two-sided — from one participant to another, or between one participant and the group split by the usual rules — so it has the same payments-in / shares-out shape as every other entry and cannot break Σ balances == 0 (I2). A one-sided "add €70 to Robert" is not expressible. *Shipped in both shapes: person → person, and one person against the group split by the usual rules (either direction). The person is never on the group side — a correction they carry a slice of is just an expense.* |
| FR-6.2 | S | Adjustments are visually distinct in the ledger and listed in the trip summary. *Shipped: 🧾 icon, own ledger filter, reason on the row and the detail, and their own section with a running total on the overview.* |
| FR-6.3 | M | The app must never require an adjustment to make totals reconcile — FR-9.1 guarantees that. |

### FR-7 Balances and overview

| ID | Priority | Requirement |
|---|---|---|
| FR-7.1 | M | Per-participant: total paid, total owed, net balance; plus trip grand total (the `Gesamt` row). |
| FR-7.2 | M | Personal view: "You owe X to Robert" / "You get back Y", as the app's home screen. |
| FR-7.3 | M | Distinguish **total** vs **already settled** vs **outstanding** (the `Bereits gezahlte Kosten` / `Offen` rows), with an as-of timestamp. |
| FR-7.4 | S | Per-share status: a participant's share of a specific expense can be marked settled (the green cells in the `Miete` rows), independent of the trip-wide settlement. *Confirmed in scope (D6).* |
| FR-7.5 | S | Ledger view: chronological, searchable, filterable by participant / category / type / date. |
| FR-7.6 | S | Drill-down: tapping a balance shows exactly which entries produced it. |
| FR-7.7 | C | Statistics: spend per category, per person, per day; largest expense; spend curve over the trip. |
| FR-7.8 | C | Export CSV / XLSX / PDF (a spreadsheet-shaped export eases the migration away from the sheet and gives an exit path). *CSV shipped: entries × participants, totals and the settlement plan, in the locale's dialect; XLSX and PDF still open.* |

### FR-8 Settlement

| ID | Priority | Requirement |
|---|---|---|
| FR-8.1 | S | Gross debt matrix, who-owes-whom before netting (sheet rows 42–46). |
| FR-8.2 | M | **Bilateral netting** view — the plan the group builds by hand today, so the numbers read as familiar: you pay the person you actually owe. |
| FR-8.3 | M | **Optimal settlement**: minimal set of transfers clearing all balances; show the transfer count saved vs bilateral. *Shipped: every plan but bilateral itself states what it saves against it.* |
| FR-8.4 | S | Let the user choose the algorithm; explain the trade-off (fewest transfers vs "I pay the person I actually owe"). *Shipped: one line under the chosen plan says what it costs and what it buys.* |
| FR-8.5 | S | Pin a hub ("route everything through Robert"): every other member makes or receives exactly one transfer, with the hub; the hub handles up to n−1. Total transfers are exactly the number of non-hub members with a non-zero balance — never fewer than optimal (FR-8.3), often equal, and simpler to execute. Show the count next to the other plans. *Confirmed in scope (D6).* |
| FR-8.6 | M | Every proposed transfer is one tap away from being recorded as a real transfer (FR-5.4). |
| FR-8.7 | S | Trip lifecycle: `open` → **`settling`** (an admin freezes the plan; no new expenses, transfers still recorded against it; balances visibly count down) → **`closed`** (automatic once every balance is zero at `Money` precision, I5; read-only). An admin can move `settling` back to `open` — logged — if an expense was forgotten; `closed` → `open` also requires an admin and is logged. |
| FR-8.8 | S | Share the settlement plan as text/image into WhatsApp. |

### FR-9 Correctness guarantees

| ID | Priority | Requirement |
|---|---|---|
| FR-9.1 | M | Invariants I1–I5 (§5) enforced in the domain layer and asserted by database constraints/tests; violations are impossible to persist, not merely reported. |
| FR-9.2 | M | The two-tier precision model of §5.1 is enforced by the type system: `Money` and `Precise` are distinct types, converting `Precise` → `Money` is only possible through the boundary function that applies P4, and binary floats are absent from storage, transport and arithmetic. |
| FR-9.3 | M | Balances are **derived** from entries and never stored as an editable field. |
| FR-9.4 | S | A "reconciliation" self-check surfaced in the UI: Σ balances == 0, Σ shares == Σ expenses, evaluated at full `Precise` precision. |
| FR-9.5 | S | Concurrent edits resolved without silent loss (per-entry versioning; last-writer-wins with a conflict notice). |
| FR-9.6 | S | Display honesty: where a rounded figure differs from the exact one, the UI must not present the rounded value as exact. Rounded per-share amounts always sum to the displayed total (P4); a settlement residual is attributed to a named member, not hidden. |

### FR-10 Collaboration, history, notifications

| ID | Priority | Requirement |
|---|---|---|
| FR-10.1 | M | Multiple people edit the same trip; changes appear for others without a manual refresh (poll or push). |
| FR-10.2 | S | Full audit trail per entry: who created/edited/deleted, when, and what changed. *Shipped for shared trips: `GET /trips/:id/entries/:eid/history` returns every recorded state with its actor, and the entry screen renders the differences. A local-only trip has no server and therefore no trail.* |
| FR-10.3 | S | Trip activity feed. |
| FR-10.4 | C | Push notification on new expense involving me, and on debt settled. |
| FR-10.5 | C | Comments/emoji reactions on an entry (resolves "what was this €38.95 again?"). |

### FR-11 Offline & availability

| ID | Priority | Requirement |
|---|---|---|
| FR-11.1 | M | Read the ledger offline (cached). |
| FR-11.2 | S | Create/edit entries offline, queued and synced when connectivity returns (roaming abroad, mountains, ferries). |
| FR-11.3 | S | Offline entries are visibly marked as pending sync; sync conflicts surfaced, never silently dropped. |

---

### FR-12 Plans, entitlements and retention

Consequence of D11–D13. The MVP builds the *mechanism*, not the commerce.

| ID | Priority | Requirement |
|---|---|---|
| FR-12.1 | M | Every account carries a **plan**; a trip's effective limits are resolved from the plan of the member who created it (the one paying for its storage, so the one whose plan applies). v0.1 ships a single plan granting everything — the model exists, the restriction does not. |
| FR-12.2 | M | All limit checks go through **one entitlement service**. No feature queries a plan directly, and no limit is special-cased in the domain layer — the gating axis is undecided (D13), so nothing may assume which limit matters. |
| FR-12.3 | S | Receipt retention is a plan-derived attribute with a per-trip override (D11); default **12 months**, counted from the trip's close date or, for a trip never closed, from its last entry — so an abandoned trip is purged too. |
| FR-12.4 | M | Each trip stores its retention setting, and each receipt its `uploaded_at`, from the first migration — so the purge job (FR-12.6) needs no backfill. |
| FR-12.5 | S | Members are warned before receipts are purged, with time to export. |
| FR-12.6 | C | The **purge job** itself: delete receipts past retention, log the deletion, keep the entry that referenced them intact. Deferred to v0.2 (D11); until it ships, storage grows without bound. |
| FR-12.7 | C | Billing: in-app purchase on both stores (required for digital subscriptions — no external payment flow is permitted inside the app), subscription state, receipt validation, paywall UI. Deferred past v0.2 (D12). |
| FR-12.8 | W | Any paywall, limit enforcement or upgrade prompt in v0.1. |

---

## 7. Settlement algorithm specification

Notation: `b_i` = balance of participant *i*, a `Precise` value. `b_i > 0` ⇒ *i*
is owed money.

```
b_i = Σ payments_i − Σ shares_i        over every entry type
```

One formula because every entry type has the same shape (§5): a transfer out is
a payment, a transfer in is a share, an adjustment is one or the other with a
reason. I2 (Σ b_i == 0) follows directly from I1.

**Bilateral netting (FR-8.2)** — reproduces today's sheet:
build the gross matrix `D[a][b]` = what *a* owes *b*, accumulated per entry
(payer gets credited, each beneficiary debited). Then for each pair
`net = D[a][b] − D[b][a]`; emit one transfer for the positive direction.

*Illustration (from the sheet, for clarity on what "bilateral" means):* Max owes
Yannik €21.88 and Yannik owes Max €11.75 → Max pays Yannik **€10.13**. Yannik
owes Robert €150.54, Robert owes Yannik €41.88 → Yannik pays Robert **€108.66**.
This is documentation of the algorithm, not a test fixture (D7).

**Optimal settlement (FR-8.3):** the minimum number of transfers is
*n − k*, where *k* is the largest number of disjoint zero-sum subsets the
non-zero balances can be partitioned into; finding *k* is NP-hard in general.
Two implementations, selected by group size:

- *n ≤ 16:* **exact** — for each subset mask of the non-zero balances,
  `dp[mask] = max over i∈mask of dp[mask∖i] + [sum(mask) = 0]`; the largest
  number of disjoint zero-sum groups is `dp[full]`, and greedy inside each
  group yields exactly `|group| − 1` transfers. O(2ⁿ·n) ≈ 10⁶ steps at n = 16,
  milliseconds. Guaranteed minimal; verified against brute force.
- *n > 16:* **greedy** max-debtor ↔ max-creditor matching, at most *n − 1*
  transfers. Not always minimal: balances `[+2, +3, −4, −5, +4]` take 4
  transfers under greedy but 3 optimally (`{+4, −4}` and `{+2, +3, −5}`). Good
  enough where exact search would be slow, and n > 16 is rare for this product.

Ties are broken by stable participant order so the plan is identical on
recomputation.

**Rounding boundary (§5.1 P3).** Balances enter the algorithm as `Precise` and
leave it as `Money`: settlement is the point where exactness ends, because the
output is a list of real transfers. Round the balance vector to minor units with
largest remainder (P4) *before* matching, so the rounded balances still sum to
zero, then match. A residual of a fraction of a cent is assigned to a named
member — deterministically, and visibly in the UI (FR-9.6) — never dropped.

**Requirements on any plan:** total transferred == Σ positive balances; no
participant appears as both sender and receiver; recomputation with unchanged
input yields an identical plan; every amount ≥ the currency's minor unit; and
applying the plan drives every balance to exactly zero.

---

## 8. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Platform | **React Native (Expo)**: one TypeScript codebase producing iOS and Android builds for the stores, plus a web build from the same source (D1). The web build is the zero-install path for joining mid-trip and the fastest surface to test on. |
| NFR-2 | Performance | Add-expense flow ≤ 15 s median; any screen interactive < 1.5 s on 4G mid-range Android; balance recomputation < 100 ms for 1,000 entries. |
| NFR-3 | Scale | **Multi-tenant schema from day one** (D5): no hardcoded participants, no single-group assumptions. Design target 20 participants and 5,000 entries per trip; correctness must hold to 10,000 trips without a schema change, though only this group's trip is operated at launch. |
| NFR-4 | Availability | Best-effort hosting; offline read (FR-11.1) means an outage never blocks the trip. |
| NFR-5 | Security | Trip data readable only by members; share links carry a high-entropy token, are revocable, and expire; all traffic over TLS. |
| NFR-6 | Privacy / GDPR | Personal data limited to display name + e-mail; export and delete-my-data supported (FR-1.9); receipts in a private bucket behind signed, expiring URLs; EU hosting. Retention: 12 months after a trip closes by default, configurable per trip, enforced by FR-12.6 once it ships. |
| NFR-7 | Data integrity | Nightly backups, point-in-time restore; soft deletes; append-only audit log. |
| NFR-8 | i18n / l10n | **English source strings, German shipped from v0.1** (D10). No user-facing string hardcoded in a component; all text extracted from the first commit. Locale-aware number and date formatting (`€1.234,56` vs `€1,234.56`); currency symbol per trip. |
| NFR-9 | Accessibility | WCAG 2.1 AA: don't encode meaning in colour alone (the sheet's green cells need an icon/label equivalent), touch targets ≥ 44 px, screen-reader labels. |
| NFR-10 | Cost | Hostable for < €10/month at this group size. |
| NFR-11 | Maintainability | Split/settlement logic in a pure, framework-free module with property-based tests: invariants I1–I5 and the precision rules P1–P7 expressed as properties over generated trips (random amounts, participant counts, split rules, refunds and transfers). This is the primary correctness net. |
| NFR-12 | Observability | Error tracking + a daily invariant check alerting if any trip's balances don't sum to zero. |
| NFR-13 | Testability | No spreadsheet-derived fixtures or import tooling (D7). Correctness is demonstrated by the property tests of NFR-11 plus worked unit cases for the known-hard splits (n-way indivisible amounts, refunds, mixed exact/equal, settlement residuals). CI fails on any invariant violation. |
| NFR-14 | Portability | Hosting is deferred (D3), so three constraints are binding from the first commit: (a) `trip_id` on every row; (b) no query, index or job that spans trips; (c) the domain layer imports no framework, ORM or vendor SDK. Managed auth and managed storage may be used at the edges, never inside the core. |
| NFR-15 | Store compliance | Both stores at launch (D9). Release-blocking, not polish: privacy nutrition labels / Data Safety form, in-app account deletion (FR-1.9), Sign in with Apple parity (FR-1.10), a reachable privacy policy and support URL, age rating. Digital subscriptions must use in-app purchase on both platforms (15–30%), which constrains any future pricing (FR-12.7). Listing assets are deferred with the public launch (D14); the compliance items above are not. Budget review latency into every release. |

---

## 9. UX: screens and key flows

**Screen inventory (MVP)**

0. **Sign-in / join** — Sign in with Apple, Google or e-mail (D2); an invite
   link lands here first, then on the trip, then on "which participant are
   you?" (claim a placeholder or create a new one).
1. **Trip list** → open trips with my balance per trip.
2. **Trip home** — my balance headline ("You owe €254.99"), per-person balance
   list, recent entries, big ⊕ Add button.
3. **Add/edit entry** — amount keypad first, then description, payer, split
   selector (chips per participant + rule tabs Equal / Exact / Shares), live
   "€x per person" preview and a residual indicator.
4. **Ledger** — chronological list, filters, search.
5. **Entry detail** — shares, payer, receipt, history, comments.
6. **Balances & settle up** — matrix + settlement plan, per-transfer "Mark as
   paid".
7. **Trip settings** — participants (add placeholder, remove), invite link,
   currency, retention, freeze plan / reopen.
8. **Account** — display name, linked sign-in methods, export my data, **delete
   account** (FR-1.9, required by the stores).

**Key flows**

- *Fast capture:* Trip home → ⊕ → type `24,80` → "Pizza" → save. Two taps beyond
  typing; payer and split default to last used.
- *Exclusion:* on the split row, tap Marc's chip to grey him out; per-person
  amount updates live (`Rulantica` case).
- *Uneven meal:* switch to Exact tab, type each amount; save blocked while the
  residual ≠ 0, with a one-tap "put the rest on me".
- *Settle up:* Balances → pick plan (Bilateral | Fewest transfers | Via Robert)
  → "Mark paid" → transfer recorded and counted at once; recipient is notified
  and can dispute (FR-5.3).
- *Join mid-trip:* Robert adds "Lena" as a placeholder on day 1 and splits
  dinner against her; Lena installs on day 3, signs in, opens the link, claims
  "Lena" — her dinner share is already on her balance.

---

## 10. Technical sketch (non-binding, for feasibility only)

Shaped by D1 (stores), D2 (accounts), D3 (portability), D5 (multi-tenant).

- **Client:** React Native via Expo — iOS, Android and web from one TypeScript
  source. Local-first store (SQLite on device / IndexedDB on web) with a sync
  queue for FR-11.2. Expo EAS for builds and over-the-air JS updates, which cut
  review latency for non-native fixes.
- **Server:** small REST/RPC API + Postgres. Entries are append-mostly; shares
  live in a child table with a deferred constraint asserting Σ shares == entry
  amount. `Participant` is its own table (nullable `user_id` for placeholders and
  tombstones); shares and payments reference it, never `User`. Every table
  carries `trip_id` (NFR-14) and row-level access is filtered by membership.
- **Money:** two types per §5.1 — `Money{amount: bigint minor units, currency}`
  for payable values and `Precise{amount: DECIMAL(20,8), currency}` for derived
  shares and balances. No `float`/`double` column anywhere; money crosses the
  wire as strings, not JSON numbers. `currency` and `fx_rate` (itself
  high-precision) exist from the first migration though the MVP writes one
  currency (D4).
- **Auth:** Sign in with Apple, Google, and e-mail magic link, all mapping to one
  internal user (FR-1.10 makes Apple mandatory alongside Google). Invite tokens
  hashed at rest, revocable, expiring. Account deletion tombstones the
  participant without deleting trip entries (FR-1.9).
- **Domain module:** split allocation, balance derivation and both settlement
  algorithms in a pure package with no framework, ORM or vendor import — shared
  by client and server, covered by property tests over the invariants and the
  precision rules (NFR-11).
- **Notifications:** a `Notifier` port (send-email, send-push) with a throwaway
  v0.1 adapter — Expo push, any SMTP for magic links (D16). No provider SDK
  reaches the core.
- **i18n:** string catalogue from the first commit, English source, German
  shipped (D10). A lint rule fails the build on a user-facing literal in a
  component.
- **Entitlements:** one service resolving a plan to a named set of limits
  (FR-12.1–12.2). v0.1 has a single all-permitting plan; nothing downstream knows
  which limit will eventually matter (D13).
- **Deferred by D3:** the concrete host. Any managed Postgres, any object store
  with signed URLs, any CDN. The core must not learn their names.

---

## 11. Release plan

**v0.1 MVP — "replaces the sheet for one trip"**
FR-1.1–1.3, FR-1.9–1.10, FR-2.1–2.3, FR-3.1–3.4, FR-3.6, FR-4.1, FR-5.1–5.2,
FR-7.1–7.3, FR-8.2, FR-8.3, FR-8.6, FR-9.1–9.3, FR-9.6, FR-10.1, FR-11.1,
FR-12.1–12.2, FR-12.4, NFR-8, NFR-11, NFR-13–15.
*Exit criteria:* (a) the property suite (NFR-11) passes, including the precision
rules P1–P7; (b) the five of you run a whole trip in it without opening a
spreadsheet.

*Also needed before v0.1 ships:* SMTP credentials for the magic link (Q11c).
Without them nobody outside this machine can sign in — the dev API's
`/dev/magic-links` is a local convenience, not a delivery channel.

*Distribution note:* v0.1 needs no public store listing (D14). The channel —
TestFlight plus Play internal testing, or sideloaded dev builds — is still open
(D15) and must be settled before v0.1 ships; TestFlight needs a paid Apple
account and light review, free-account sideloading expires every 7 days per
device. Either way the listing and marketing assets wait for v0.3, while FR-1.9,
FR-1.10 and the privacy forms are built in v0.1 regardless, because retrofitting
auth and deletion is expensive.

*Also in v0.1 because retrofitting is expensive:* i18n extraction with German
shipped (D10), the entitlement service (D12), and retention metadata (D11) —
each of them cheap now and invasive later.

**v0.2 — "pleasant"** — complete as of this branch.

Receipt purge job (FR-12.6), categories, receipts, per-share settled status (FR-7.4), gross matrix (FR-8.1),
preferred-creditor routing (FR-8.5), tips (FR-3.7), weights/percentages
(FR-3.5), ledger filters + drill-down, adjustments (FR-6), audit trail
(FR-10.2), offline write (FR-11.2), export (FR-7.8), trip lifecycle with
freeze/reopen (FR-8.7), transfer dispute (FR-5.3).

**v0.3 — "shippable to others"**
Statistics, payment deep links (FR-5.5), push notifications, comments,
multi-currency (FR-2.8), instalments (FR-2.10), split presets, plus the public
launch scaffolding deferred in §1.2: onboarding, empty states, privacy policy,
support URL, store listing assets, crash reporting. Billing and in-app purchase
(FR-12.7) only once the gating axis is decided (D13).

**Later / evaluate**
Receipt OCR, itemized splits, sub-group presets.

---

## 12. Open questions

All questions raised in the v1.0 and v1.1 drafts are now either answered or
consciously deferred; §1.3 records both. Nothing here blocks *starting* the MVP.
Two items block *shipping* it: Q10 (how it reaches the group) and Q11c (the
credentials that let anyone sign in).

| # | Question | Impact | Proposed default | State |
|---|---|---|---|---|
| Q12b | When does the purge job actually ship? | Storage cost grows until it does | v0.2 | Deferred (D11) |
| Q15 | What does the paid tier gate — and in what shape? | Pricing, and eventually the limit checks | None yet. ~~Retention or storage volume~~ — the cost note in §1.3 removes that rationale. A per-trip unlock was considered and rejected: it charges whoever organises the trip, which taxes the most engaged member | **Open, deliberately — revisit after the first real trip (G1).** Nothing in the code presumes an answer: one unlimited plan, no paywall, no IAP. Deciding early would be a guess about a product that has no users yet |
| Q10 | TestFlight/internal testing, or sideloaded dev builds, for v0.1? | How your group installs it | TestFlight + Play internal | **Open** (D15), needed before v0.1 ships |
| Q11c | **Mail**: which SMTP credentials for the magic link? | Nobody signs in without it | Any transactional provider's free tier; five people send a handful of links | **Open, needed before v0.1 ships** — not an architecture choice: the `Notifier` port has an SMTP adapter (nodemailer) and `main.ts` takes any `SMTP_URL`, falling back to a recording notifier without one |
| Q11b | **Push**: which provider, once volume is known? | Cost, deliverability | Expo push; decide at v0.3 | Deferred (D16). No adapter yet; FR-5.3's "the recipient is notified" waits on this and surfaces on the next sync until then |
| Q13b | Price point and free-tier shape, if it goes paid? | Revenue, IAP maths at 15–30% | Not before a real trip has run | Deferred (D12) |

Answered questions Q1–Q9, Q11, Q12, Q14 are recorded in §1.3.

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Group falls back to the spreadsheet mid-trip | Project fails G1 | Nail fast capture + offline first; CSV export as a safety valve |
| **Signup wall (D2) blocks entry during the trip** | Adoption; the wall lands exactly when people are on bad roaming | Placeholder participants (FR-1.3) are must-have, not nice-to-have; sign-in must work on a weak connection and survive backgrounding |
| **App-store review delays a mid-trip fix** | You can't patch a bug while travelling | TestFlight/internal builds for the group; Expo over-the-air updates for JS-only fixes; the web build as an always-current escape hatch |
| **Apple rejection on account rules** | Launch blocked late | FR-1.9 and FR-1.10 built in v0.1, not retrofitted |
| Rounding disputes over cents | Trust | Exact shares held at full precision, rounding confined to the display and settlement boundaries (§5.1); the residual is always attributed to a named member, never hidden |
| **Precision model leaks** — a `Precise` value rounded early, or a float sneaking in via JSON | Silent drift returns, harder to spot than before | Distinct types with conversion only through the boundary function (FR-9.2); lint ban on float types in the domain package; P1–P7 asserted as properties |
| Someone edits history after settling | Trust | Closed trips read-only; audit trail; reopen requires admin |
| Receipt storage cost/privacy | Cost, GDPR | Client-side compression, retention limit (Q12), signed URLs |
| **Product ambition (D5) inflates the MVP** | Never ships — the doc's original top risk, now likelier | D5 is a schema and structure commitment only; every product-facing feature stays behind the §1.2 line until a real trip has run |
| **Deferred hosting (D3) leaks vendor coupling into the core** | Portability lost silently | NFR-14 enforced by a lint rule banning vendor imports in the domain package |
| ~~Receipt storage grows unbounded until the purge job ships (D11)~~ **Closed in v0.2** | Cost, and a weaker GDPR position in the meantime | The purge job shipped (FR-12.6) and runs against retention metadata captured from day one. The cost note in §1.3 also shows the exposure was small: single-digit MB per trip |
| **Entitlement model built before the gating axis is known (D13)** | Over-abstraction — indirection serving a limit that never arrives | Keep it to a plan → named limits map and one service; no paywall, no limit enforcement, no UI until D13 resolves |
| **IAP takes 15–30% of any subscription** | Undermines a storage-cost-recovery model | Know it before pricing (NFR-15); the margin has to clear both the store cut and the storage bill |
| **Two review queues (D9) double the release friction** | Slower fixes once public | Over-the-air JS updates for non-native changes; the web build as an always-current escape hatch |
