# Vacation Spending Tracker — Requirements

Status: **Draft v1.0** · Owner: project team · Date: 2026-09-08

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
| G5 | Low friction to join | New participant onboarded via a share link in ≤ 1 min, no app store account needed |

### 1.2 Non-goals (explicitly out of scope for v1)

- Executing real money transfers (no PSP/banking integration; we only *link out*
  to PayPal.me / generate SEPA payment data).
- Bank/credit-card statement import.
- Budgeting, forecasting or savings goals.
- Trip planning: itineraries, bookings, packing lists.
- Public/social features, feeds, or sharing outside the group.

---

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
| **Trip** | A container for participants, a currency, and a ledger of entries. Also called a group. |
| **Participant** | A person in a trip. May be a registered user or a name-only placeholder. |
| **Entry** | Any line in the ledger. One of: Expense, Reimbursement, Transfer, Adjustment. |
| **Expense** | Money that left the group, paid by one (or more) participants, split among beneficiaries. |
| **Payer** | Participant(s) who actually paid the merchant. The sheet's `an wen?` column. |
| **Share** | The portion of an entry attributed to one beneficiary. |
| **Split rule** | How the total is divided: equal, shares/weights, percentage, exact amounts, or per-item. |
| **Reimbursement** | Money that came *into* the group and reduces cost (bottle deposit `Pfandsammlung`, cashback, refund). Modeled as a negative expense. |
| **Transfer** | A payment from one participant directly to another (the sheet's `Zahlung` rows). Settles debt; is *not* a trip cost. |
| **Adjustment** | A manual correction booked against a participant's balance, with mandatory reason (the sheet's `Umbuchung`). |
| **Balance** | For a participant: total paid + reimbursements received − total owed. Positive = is owed money (creditor). |
| **Gross debt matrix** | Who owes whom before netting (sheet rows 42–46). |
| **Settlement plan** | The list of transfers that brings all balances to zero (sheet rows 49–53). |
| **Bilateral netting** | Cancelling debts only between pairs: A owes B €21.88, B owes A €11.75 → A pays B €10.13. |
| **Optimal settlement** | The minimum number of transfers that clears all balances group-wide. |
| **Settled / Closed** | A trip whose settlement plan is fully executed and which becomes read-only. |

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
   → *The app must guarantee Σ shares == total by construction (FR-3.6).*
2. **Rounding drift on equal splits.** €55.18 / 5 = €11.036, stored as €11.04 ×
   5 = €55.20. Cents are invented.
   → *Largest-remainder allocation of integer cents (FR-3.6).*
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
User ──< Membership >── Trip ──< Entry ──< Share
                          │        │
                          │        ├─ Payment (who fronted the money, n≥1)
                          │        └─ Attachment (receipt photo)
                          ├─ Currency (base)
                          └─ SettlementPlan (derived)
```

**Entities**

- **User** — identity (email/OAuth or anonymous device identity), display name.
- **Trip** — name, base currency, date range, members, status
  (`open` | `settling` | `closed`), created_by.
- **Membership** — user ↔ trip, role (`member` | `admin`), `joined_at`,
  `left_at` (a person who joins late is not a beneficiary of earlier expenses).
- **Entry** — `type` ∈ {`expense`, `transfer`, `adjustment`}, description,
  amount (signed, minor units), currency + FX rate to base, date, category,
  created_by, created_at, deleted_at, note.
- **Payment** — (entry, participant, amount) — who put the money down. Supports
  more than one payer per expense.
- **Share** — (entry, participant, amount, weight?) — who owes what. Sum of
  share amounts == entry amount, enforced.
- **Attachment** — receipt image/PDF bound to an entry.

**Invariants** (see FR-9):

- I1: for every entry, `Σ shares == Σ payments == entry.amount`
- I2: for every trip, `Σ over participants of balance == 0`
- I3: money is stored as signed integers in minor units; no floats anywhere
- I4: a `transfer` moves balance between two participants and contributes €0 to
  trip cost

---

## 6. Functional requirements

Priority uses MoSCoW: **M** = must (MVP), **S** = should (v1), **C** = could
(later), **W** = won't (this release).

### FR-1 Trips, members, access

| ID | Priority | Requirement |
|---|---|---|
| FR-1.1 | M | Create a trip with name, base currency, optional start/end date. |
| FR-1.2 | M | Invite members via a share link; joining requires no app-store account (magic link / anonymous identity upgradeable later). |
| FR-1.3 | M | Add a **placeholder participant** (name only, no account) so someone offline can still be split against, and later merge them into a real user. |
| FR-1.4 | S | Roles: any member can add/edit entries; only admins can delete members, close the trip, or edit a closed trip. |
| FR-1.5 | S | A member who joins on day 3 is excluded by default from earlier expenses (`joined_at`). |
| FR-1.6 | S | Remove a member only if they hold a zero balance; otherwise require settlement first. |
| FR-1.7 | C | Multiple trips per user, with an archive view. |
| FR-1.8 | C | Sub-groups within a trip ("the 3 who did Rulantica") as reusable split presets. |

**Acceptance (FR-1.2):** opening the share link on a fresh phone shows the trip
and lets the visitor claim a participant slot or create a new one, without
e-mail verification blocking entry.

### FR-2 Recording an expense

| ID | Priority | Requirement |
|---|---|---|
| FR-2.1 | M | Add expense: description, amount, date (defaults to now), payer (defaults to me), split rule. |
| FR-2.2 | M | Edit and soft-delete any entry; deletions are reversible and visible in history. |
| FR-2.3 | M | Payer selectable from participants; **multiple payers** with explicit amounts (replaces `an wen?`). |
| FR-2.4 | S | Category with icon (rent, groceries, fuel, tolls, parking, restaurant, activity, other) — derived from the sheet's actual rows. |
| FR-2.5 | S | Attach one or more receipt photos, camera-first on mobile. |
| FR-2.6 | S | Allow a €0.00 entry as a placeholder to be filled in later; flag it as incomplete. |
| FR-2.7 | S | Duplicate an entry ("same again"), and templates for recurring costs (fuel, tolls). |
| FR-2.8 | C | Multi-currency: enter in local currency, store FX rate to base, show both. |
| FR-2.9 | C | OCR the receipt total, and per-item parsing for itemized splits. |
| FR-2.10 | C | Recurring/instalment expense (`Miete 1/2`, `Miete 2/2` with due dates 18.11.2025 / 08.02.2026). |

### FR-3 Splitting

| ID | Priority | Requirement |
|---|---|---|
| FR-3.1 | M | Split among a selectable subset of participants (default: all active members). |
| FR-3.2 | M | **Equal** split. |
| FR-3.3 | M | Include/exclude toggle per participant, one tap each. |
| FR-3.4 | M | **Exact amounts** per participant (covers `Casamore`, `Essen Saarbrücken`). |
| FR-3.5 | S | **Weights/shares** (e.g. 2:1:1) and **percentages**. |
| FR-3.6 | M | Guarantee Σ shares == total: on equal/weight/percentage splits, distribute the remainder cents deterministically (largest remainder, tie-break by stable participant order, rotating the starting index across entries so the same person doesn't always absorb the extra cent). On exact-amount splits, block saving until the residual is €0.00, offering "assign remainder to …". |
| FR-3.7 | S | Per-person surcharge line on an entry — **tip** (`Trinkgeld p.P.`), service charge, deposit — added on top of the split base. |
| FR-3.8 | S | Remember the last split configuration per trip and per category as the default. |
| FR-3.9 | C | Itemized split: enter line items, assign each to people, tip/tax distributed proportionally. |
| FR-3.10 | C | Named split presets ("everyone but Marc"). |

**Acceptance (FR-3.6):** €55.18 split equally among 5 produces shares
11.04/11.04/11.04/11.03/11.03 summing to exactly 55.18; no UI path can persist
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
| FR-5.3 | S | Mark a transfer as *proposed* → *confirmed by recipient*; only confirmed transfers clear debt in the "already settled" view, while both are visible. |
| FR-5.4 | S | One-tap "settle up" that pre-fills a transfer from the settlement plan. |
| FR-5.5 | C | Deep-link to PayPal.me / generate SEPA QR (EPC) or a copyable IBAN block for the recipient. |
| FR-5.6 | W | Executing the payment inside the app. |

### FR-6 Adjustments

| ID | Priority | Requirement |
|---|---|---|
| FR-6.1 | S | Book a manual adjustment against one or more participants with a **mandatory reason** (replaces `Umbuchung für die Gesamtzeile`). |
| FR-6.2 | S | Adjustments are visually distinct in the ledger and listed in the trip summary. |
| FR-6.3 | M | The app must never require an adjustment to make totals reconcile — FR-9.1 guarantees that. |

### FR-7 Balances and overview

| ID | Priority | Requirement |
|---|---|---|
| FR-7.1 | M | Per-participant: total paid, total owed, net balance; plus trip grand total (the `Gesamt` row). |
| FR-7.2 | M | Personal view: "You owe X to Robert" / "You get back Y", as the app's home screen. |
| FR-7.3 | M | Distinguish **total** vs **already settled** vs **outstanding** (the `Bereits gezahlte Kosten` / `Offen` rows), with an as-of timestamp. |
| FR-7.4 | S | Per-share status: a participant's share of a specific expense can be marked settled (the green cells in the `Miete` rows), independent of the trip-wide settlement. |
| FR-7.5 | S | Ledger view: chronological, searchable, filterable by participant / category / type / date. |
| FR-7.6 | S | Drill-down: tapping a balance shows exactly which entries produced it. |
| FR-7.7 | C | Statistics: spend per category, per person, per day; largest expense; spend curve over the trip. |
| FR-7.8 | C | Export CSV / XLSX / PDF (a spreadsheet-shaped export eases the migration away from the sheet and gives an exit path). |

### FR-8 Settlement

| ID | Priority | Requirement |
|---|---|---|
| FR-8.1 | S | Gross debt matrix, who-owes-whom before netting (sheet rows 42–46). |
| FR-8.2 | M | **Bilateral netting** view — matches what the group does today, so the first run can be cross-checked against the sheet. |
| FR-8.3 | M | **Optimal settlement**: minimal set of transfers clearing all balances; show the transfer count saved vs bilateral. |
| FR-8.4 | S | Let the user choose the algorithm; explain the trade-off (fewest transfers vs "I pay the person I actually owe"). |
| FR-8.5 | S | Pin a preferred creditor ("route everything through Robert") as a constraint. |
| FR-8.6 | M | Every proposed transfer is one tap away from being recorded as a real transfer (FR-5.4). |
| FR-8.7 | S | Close a trip: settlement plan frozen, trip read-only, reopening requires an admin and is logged. |
| FR-8.8 | S | Share the settlement plan as text/image into WhatsApp. |

### FR-9 Correctness guarantees

| ID | Priority | Requirement |
|---|---|---|
| FR-9.1 | M | Invariants I1–I4 (§5) enforced in the domain layer and asserted by database constraints/tests; violations are impossible to persist, not merely reported. |
| FR-9.2 | M | All money as signed integer minor units; no floating point in storage, transport or arithmetic. |
| FR-9.3 | M | Balances are **derived** from entries and never stored as an editable field. |
| FR-9.4 | S | A "reconciliation" self-check surfaced in the UI: Σ balances == 0, Σ shares == Σ expenses. |
| FR-9.5 | S | Concurrent edits resolved without silent loss (per-entry versioning; last-writer-wins with a conflict notice). |

### FR-10 Collaboration, history, notifications

| ID | Priority | Requirement |
|---|---|---|
| FR-10.1 | M | Multiple people edit the same trip; changes appear for others without a manual refresh (poll or push). |
| FR-10.2 | S | Full audit trail per entry: who created/edited/deleted, when, and what changed. |
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

## 7. Settlement algorithm specification

Notation: `b_i` = balance of participant *i* in minor units. `b_i > 0` ⇒ *i* is
owed money.

```
b_i = Σ payments_i + Σ adjustments_i + Σ transfers_out_i
    − Σ shares_i                     − Σ transfers_in_i
```

**Bilateral netting (FR-8.2)** — reproduces today's sheet:
build the gross matrix `D[a][b]` = what *a* owes *b*, accumulated per entry
(payer gets credited, each beneficiary debited). Then for each pair
`net = D[a][b] − D[b][a]`; emit one transfer for the positive direction.

*Worked check against the sheet:* Max owes Yannik €21.88 (row 42), Yannik owes
Max €11.75 (row 43) → Max pays Yannik **€10.13**, exactly the green cell in row
49. Yannik owes Robert €150.54 (row 44) and Robert owes Yannik €41.88 → Yannik
pays Robert **€108.66** ✓. Yannik→Marc: €100.18 − €21.88 = **€78.30** ✓. The
algorithm must reproduce these numbers on the imported sheet as an acceptance
test.

**Optimal settlement (FR-8.3):** greedy max-debtor/max-creditor matching over
the balance vector, producing at most *n−1* transfers; ties broken
deterministically so the plan is stable across recomputations. (Exact
minimum-cardinality settlement is NP-hard; greedy is optimal in transfer count
for the group sizes involved here — n ≤ 20 — and we cap the search.)

**Requirements on any plan:** total transferred == Σ positive balances; no
participant appears as both sender and receiver; recomputation with unchanged
input yields an identical plan; every amount ≥ the currency's minor unit.

---

## 8. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Platform | Mobile-first responsive web app (PWA, installable, offline-capable). Native apps are a later option — the group is mixed iOS/Android and a link beats an app-store install. |
| NFR-2 | Performance | Add-expense flow ≤ 15 s median; any screen interactive < 1.5 s on 4G mid-range Android; balance recomputation < 100 ms for 1,000 entries. |
| NFR-3 | Scale | Design target 20 participants and 5,000 entries per trip; not a multi-tenant SaaS at launch. |
| NFR-4 | Availability | Best-effort hosting; offline read (FR-11.1) means an outage never blocks the trip. |
| NFR-5 | Security | Trip data readable only by members; share links carry a high-entropy token, are revocable, and expire; all traffic over TLS. |
| NFR-6 | Privacy / GDPR | Personal data limited to display name + optional e-mail; export and delete-my-data supported; receipts stored in a private bucket with signed, expiring URLs; EU hosting. |
| NFR-7 | Data integrity | Nightly backups, point-in-time restore; soft deletes; append-only audit log. |
| NFR-8 | i18n / l10n | German and English UI; locale-aware number/date formatting (`€1.234,56` vs `€1,234.56`); currency symbol per trip. |
| NFR-9 | Accessibility | WCAG 2.1 AA: don't encode meaning in colour alone (the sheet's green cells need an icon/label equivalent), touch targets ≥ 44 px, screen-reader labels. |
| NFR-10 | Cost | Hostable for < €10/month at this group size. |
| NFR-11 | Maintainability | Split/settlement logic in a pure, framework-free module with property-based tests (invariants I1–I4 as properties). |
| NFR-12 | Observability | Error tracking + a daily invariant check alerting if any trip's balances don't sum to zero. |
| NFR-13 | Testability | The real spreadsheet above is a golden fixture: importing it must reproduce every `Gesamt`, `Offen` and settlement figure. |

---

## 9. UX: screens and key flows

**Screen inventory (MVP)**

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
7. **Trip settings** — members, invite link, currency, close trip.

**Key flows**

- *Fast capture:* Trip home → ⊕ → type `24,80` → "Pizza" → save. Two taps beyond
  typing; payer and split default to last used.
- *Exclusion:* on the split row, tap Marc's chip to grey him out; per-person
  amount updates live (`Rulantica` case).
- *Uneven meal:* switch to Exact tab, type each amount; save blocked while the
  residual ≠ 0, with a one-tap "put the rest on me".
- *Settle up:* Balances → pick plan (Bilateral | Fewest transfers) → "Mark paid"
  → transfer recorded, recipient gets a confirmation prompt.

---

## 10. Technical sketch (non-binding, for feasibility only)

- Client: TypeScript PWA (React/Svelte), local-first store (IndexedDB) with a
  sync queue for FR-11.2.
- Server: small REST/RPC API + Postgres. Entries are append-mostly; shares in a
  child table with a deferred constraint asserting Σ shares == entry amount.
- Money: `bigint` minor units end-to-end; a `Money{amount, currency}` value type;
  no `float` column anywhere.
- Auth: magic-link e-mail + long-lived device token; share-link tokens hashed at
  rest.
- Split/settlement engine: pure module, shared client and server, property tests.

---

## 11. Release plan

**MVP (v0.1) — "replaces the sheet for one trip"**
FR-1.1–1.3, FR-2.1–2.3, FR-3.1–3.4, FR-3.6, FR-4.1, FR-5.1–5.2, FR-7.1–7.3,
FR-8.2, FR-8.3, FR-8.6, FR-9.1–9.3, FR-10.1, FR-11.1.
*Exit criterion:* the existing spreadsheet can be imported and the app reproduces
its `Gesamt`, `Offen` and settlement numbers.

**v0.2 — "pleasant"**
Categories, receipts, per-share settled status (FR-7.4), gross matrix (FR-8.1),
ledger filters + drill-down, tips (FR-3.7), weights/percentages (FR-3.5),
adjustments (FR-6), audit trail (FR-10.2), offline write (FR-11.2), export
(FR-7.8), German/English (NFR-8).

**v0.3 — "polish"**
Statistics, payment deep links (FR-5.5), push notifications, comments,
multi-currency (FR-2.8), instalments (FR-2.10), split presets.

**Later / evaluate**
Receipt OCR, itemized splits, native apps.

---

## 12. Open questions (need a decision before build)

| # | Question | Impact | Proposed default |
|---|---|---|---|
| Q1 | Web PWA or native app? | Architecture, cost | PWA (NFR-1) |
| Q2 | Accounts required, or link-only access? | Auth, security | Link + optional e-mail upgrade |
| Q3 | Self-hosted or a managed cloud? | Cost, ops | Managed, EU region |
| Q4 | Do trips ever span currencies? | FR-2.8 priority | Single base currency in MVP |
| Q5 | Is the per-share "already paid" marking (green cells) actually needed, or is trip-level settlement enough? | FR-7.4 scope | Keep, it exists in the sheet |
| Q6 | Prefer routing all settlement through one person (fewer transfers for others, more work for them)? | FR-8.5 | Offer both, default optimal |
| Q7 | Is the `Trinkgeld p.P.` column live in the next trip, or vestigial? | FR-3.7 priority | Build in v0.2 |
| Q8 | Should past trips be importable from the sheet, or start fresh? | Import tooling | Import the current trip once, as the golden test |

## 13. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Group falls back to the spreadsheet mid-trip | Project fails G1 | Nail fast capture + offline first; CSV export as a safety valve |
| Rounding disputes over cents | Trust | Deterministic, documented allocation; show exactly who took the extra cent |
| Someone edits history after settling | Trust | Closed trips read-only; audit trail; reopen requires admin |
| Receipt storage cost/privacy | Cost, GDPR | Client-side compression, retention limit, signed URLs |
| Scope creep into a Splitwise clone | Never ships | MoSCoW above; MVP exit criterion is a single trip |
