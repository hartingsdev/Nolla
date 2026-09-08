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
