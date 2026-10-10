# Credit cards module

A fork-only domain for Brazilian credit cards. It sits beside Actual's
accounts and transactions. It does not replace them.

The ledger stays in Actual. Every purchase, fee, refund and payment that
really happened is an ordinary transaction on the card's account, imported
by bank sync or by the existing CSV/OFX importer. This module stores the
facts Actual has no place for: the card's cycle, the bank's confirmed bill
total, which transaction belongs to which bill, installment plans, and how
a payment is split across bills. Projected installments are computed and
shown. They are not inserted as transactions.

Account balances stay a sum of `transactions.amount`
(`packages/desktop-client/src/spreadsheet/bindings.ts`). Because the module
never writes `transactions` on its own, it cannot move a balance. The one
exception is an explicit, previewed action on a manual card that posts that
bill's installments through Actual's normal transaction API. The user
triggers it; nothing posts during sync.

## Why a separate domain

A bill is not the negative balance of the card account. On the Inter card
that motivated this work the October bill is R$ 948.25, future installments
add R$ 665.90, and the bank's "total commitment" is R$ 1,614.15. Pluggy
reports the used limit, which also includes purchases authorized but not yet
in the feed. Those six numbers are different and the UI keeps them separate:

1. Current bill (confirmed by the bank when it has one, otherwise computed).
2. Still to pay by the due date.
3. Already paid.
4. Future commitments.
5. The account balance Actual already computes.
6. Total limit and available limit, each with its source.

## What already existed

`personal` already reads closed Pluggy bills for the dashboard:

- `POST /pluggyai/bills` in
  `packages/sync-server/src/app-pluggyai/app-pluggyai.js` returns `id`,
  `dueDate`, `totalAmount`, `minimumPaymentAmount` and `paidAmount`.
- `pluggyai-bills` in
  `packages/loot-core/src/server/credit-card-bills/app.ts` converts those
  amounts to integer cents.
- `bills-card` uses them for schedules that pay a Pluggy card
  (`billOccurrences.ts`, `pickCardBill`).
- The MCP tool `get_card_bills` calls the same handler.

The module keeps the handler name and the fields those callers read. New
fields are additive. The handler moves to
`packages/loot-core/src/server/credit-cards/app.ts` and
`server/credit-card-bills/` is removed.

Bank sync already stores the flattened Pluggy transaction on
`transactions.raw_synced_data`, including
`creditCardMetadata.billId`, `installmentNumber`, `totalInstallments`,
`purchaseDate`, `totalAmount` and `originalDate`. The module reads that. It
does not change the importer.

`getTransactionDateCorrected` in `app-pluggyai.js` shifts installment dates
by `installmentNumber - 1` months from `purchaseDate || date`. When
`purchaseDate` is missing the date is shifted twice, which is the PGZ
symptom in `fork/NOTES.md`. This module assigns bills from `originalDate`
and the metadata, not from the shifted `date`. Fixing the shift itself is a
separate patch, not part of this module.

## Layout

New code lives in new directories.

- `packages/loot-core/src/server/credit-cards/engine/` — pure functions.
  No database, no clock except a `today` argument.
- `packages/loot-core/src/server/credit-cards/` — handlers, SQL, Pluggy
  fetch, reconciliation.
- `packages/loot-core/migrations/<timestamp>_credit_cards.sql` and a second
  additive migration for the detail tables.
- `packages/desktop-client/src/components/credit-cards/` and
  `packages/desktop-client/src/credit-cards/` — pages, queries, mutations.
- `packages/sync-server/src/app-pluggyai/` — extended bill payload and a
  new account-details route.

Upstream files that have to change are listed under "Touch points". Each
change is additive.

## Data model

Amounts are integer cents. Bill, installment and payment amounts are
positive numbers meaning "owed" or "paid". Actual transaction amounts keep
Actual's sign (a purchase is negative) and are converted at the boundary
with `owed = -amount`. Dates are `YYYY-MM-DD`. Every synced table has a
`TEXT` primary key named `id` and `tombstone INTEGER DEFAULT 0`.

Rows that two devices would independently create use deterministic ids, so
the second writer updates the same row instead of inserting another:

- Bill: `<cardId>:<YYYY-MM>` where the month is the due month.
- Installment: `<purchaseId>:<n>`.
- Import record: hash of provider, entity type and external id.

Stored columns are facts. Status, computed total, projected total, amount
paid, amount remaining and the reconciliation gap are computed. A cell-level
last-writer-wins merge can overwrite one fact. It cannot corrupt a sum,
because the sums are not stored.

### `credit_cards`

`account_id`, `name`, `institution`, `provider` (`pluggyai` or `manual`),
`provider_account_id`, `closing_day`, `due_day`, `closing_day_policy`
(`current` or `next`), `timezone`, `credit_limit`, `credit_limit_source`,
`available_limit`, `available_limit_source`, `limit_updated_at`,
`parent_card_id`, `created_at`, `updated_at`.

`account_id` points at an existing Actual account. There is no second
balance. `parent_card_id` is unused for now; it is the seam for an
additional card that shares a limit. The available limit is whatever the
bank or the user last said. It is not `credit_limit` minus the Actual
balance.

`closing_day_policy` decides a purchase made on the closing day.
`current` puts it on the bill that closes that day. `next` puts it on the
following bill. The default is `next`, because banks disagree and guessing
`current` silently mis-files a purchase. A confirmed bill overrides the
guess.

### `credit_card_bills`

`card_id`, `reference_month`, `cycle_start`, `cycle_end`, `closing_date`,
`due_date`, `confirmed_total`, `minimum_payment`, `source`,
`provider_bill_id`, `last_confirmed_at`, `cancelled`.

A row exists only when there is a fact: a provider bill, a manual total, a
date override, or a payment allocated to that month. Months with nothing
stored are computed on read. Stored dates win over the cycle rules, and a
change to the closing day therefore affects only cycles that have no stored
row yet.

`confirmed_total` is the bank's number, kept even when the transactions
don't add up to it. The gap is shown. Nothing is adjusted to hide it.

### `credit_card_purchases` and `credit_card_installments`

A purchase is the original operation: date, merchant, description, total,
installment count, category, provider key, source, status. Each installment
has its number, amount, an optional bill override, the Actual
`transaction_id` once that installment has been imported, the provider
transaction id, and a status of `projected`, `imported`, `confirmed`,
`cancelled` or `reversed`.

Cents that don't divide evenly go to the earliest installments. The
installments sum to the purchase total.

A projected installment has no `transaction_id` and is not written to
`transactions`. When bank sync later imports that installment, reconciliation
sets `transaction_id` and the projection stops counting, so the charge is
not shown twice.

### `credit_card_transaction_links`

For transactions that are not installments: `transaction_id`, `card_id`,
`bill_id`, `kind` (`purchase`, `fee`, `interest`, `refund`, `adjustment`,
`carryover`), `source` (`provider`, `rule`, `manual`). A row overrides
cycle assignment. Interest and fees land on the bill the link names.

### `credit_card_payments`

`card_id`, `bill_id`, `transaction_id` (the card side),
`bank_transaction_id`, `amount` (the portion of this transaction applied to
this bill), `payment_date`, `source`, `status`. Splitting one payment
across two bills is two rows. The module never creates the transfer. It
points at the transfer Actual already has. Ambiguous matches go to the
review queue instead of being linked.

### `credit_card_import_records` and `credit_card_review_items`

Import records store provider, entity type, external id, fingerprint,
local id, first and last seen, and a hash of the payload. No credentials.
Review items store the card, the kind of ambiguity, the subject, the
candidate ids as JSON, and the resolution. Re-running a sync updates the
record it already has.

### Schema version

The synced pref `credit-cards-schema-version` is a number this code writes.
A build that only understands an older number opens the module read-only.
That guards a future fork-to-fork schema change. It does not affect upstream
clients, which ignore the pref.

## Billing rules

Cycles are computed by `engine/cycles.ts`.

- Closing day 31 in a 28, 29 or 30 day month clamps to the last day.
- The due date falls in the closing month when `due_day > closing_day`,
  and in the next month otherwise. The due day clamps the same way.
- Policy `current`: a cycle runs from the day after the previous closing
  date through the closing date, inclusive.
- Policy `next`: a cycle runs from the previous closing date through the
  day before this closing date.
- A stored bill for that due month replaces the computed dates.

Assignment (`engine/assignment.ts`), first match wins:

1. A transaction link or an installment bill override.
2. Pluggy `creditCardMetadata.billId` matched to `provider_bill_id`.
3. The cycle of `originalDate`.
4. The cycle of `date`.

Bill figures (`engine/bills.ts`):

- Computed total: non-projected charges assigned to the bill, in owed cents.
- Projected total: computed total plus projected installments not yet
  imported.
- Owed: `confirmed_total` when the bank sent one, otherwise the computed
  total.
- Paid: sum of payment allocations. Remaining: owed minus paid.
- Divergence: `confirmed_total - computed`, or nothing when the bank has
  not confirmed. Displayed, never written back.
- Status: `cancelled`, then `paid` when remaining is zero, then `overdue`
  when today is past the due date and something remains, then
  `partially_paid` when some payment has landed, then `open` while today
  is on or before the closing date, otherwise `closed`.

The statement shown as the current bill is the latest bill whose closing
date is on or before today. Future commitment is the sum, over later
bills, of confirmed total when present and projected total otherwise, minus
payments already allocated. Total commitment is the statement's remaining
amount plus that future commitment. The October fixture is 948.25 + 275.90
+ 195.00 + 195.00 = 1,614.15, with the account balance passed through
unchanged.

Payments (`engine/payments.ts`) allocate a positive amount onto one bill or,
on overflow, onto the next unpaid bill. They never create a transaction and
they never count as a charge. A partial payment leaves a remaining amount;
`carryoverAmount` reports it so a later step can record revolving balance
on the next bill as an explicit fact, not by editing the previous total.

Priority when several sources disagree, highest first: a closed bill the
bank confirmed, transactions assigned to the cycle, projections from
installment plans, manual figures. A missing Pluggy field stays null and
the UI says it is not available.

## Sync

New tables sync through the existing CRDT path. Any table with an `id`
primary key is a dataset. `db.insertWithUUID`, `db.update` and `db.delete_`
emit one message per cell. No change to the protocol. Details, including
what an older client does with an unknown table, are in `SYNC.md`.

## Touch points

Upstream files this module edits, each with a small additive change:

| File | Change |
| --- | --- |
| `packages/loot-core/src/types/prefs.ts` | `creditCards` flag, schema-version pref |
| `packages/desktop-client/src/hooks/useFeatureFlag.ts` | default off |
| `packages/desktop-client/src/components/settings/Experimental.tsx` | toggle |
| `packages/desktop-client/src/components/FinancesApp.tsx` | routes behind the flag |
| `packages/desktop-client/src/components/responsive/wide.ts`, `narrow.ts` | page entries |
| `packages/desktop-client/src/components/sidebar/PrimaryButtons.tsx` | nav item |
| `packages/desktop-client/src/components/sidebar/redesign/PrimaryNav.tsx` | nav item |
| `packages/desktop-client/src/components/mobile/MobileNavTabs.tsx` | nav item |
| `packages/desktop-client/src/modals/modalsSlice.ts`, `components/Modals.tsx` | modals |
| `packages/loot-core/src/server/main.ts`, `types/handlers.ts` | register the app (already patched for `credit-card-bills`) |
| `packages/loot-core/src/server/sync/reset.ts` | tombstone cleanup for the new tables |
| `packages/sync-server/src/app-pluggyai/app-pluggyai.js`, `pluggyai-service.js` | richer bills, account credit data (already patched for `/bills`) |

`sync-events.ts` is not edited. The page listens for `sync-event` itself
and invalidates its queries when a `credit_card_` table or `transactions`
changed.

## Feature flag

`creditCards` hides the route, the nav entries and the settings section.
It defaults to off. The migration still runs on every budget opened by
this fork, so the schema has to be settled before the branch is merged to
`personal`. Turning the flag off does not drop data and does not skip the
migration.

## Out of scope

PDF import. Additional cards that share a limit (`parent_card_id` is only
a column). Writing projected installments into `transactions`. Changing
`getTransactionDateCorrected`. MCP tools for the new handlers. Any edit to
the sync protocol or to the `transactions` table.
