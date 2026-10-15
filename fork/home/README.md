# Overview (Painel)

The page a tracking budget opens on (`/home`, "Overview", pt-BR "Painel"). It
replaces the budget page as the daily view for a budget that isn't budgeted
month by month: the month's bills and what is left to pay, account balances,
spending by category against the usual, and spending over time. Envelope
budgets keep opening on the budget page.

Code: `packages/desktop-client/src/components/home/`.

## Where it shows

- `/` and unknown routes redirect to `useDefaultRoute()`: `/home` for tracking
  budgets, `/budget` otherwise. Cmd+1 and the narrow/wide fallbacks follow it.
- Sidebar (classic and redesigned), mobile tab bar and command bar: "Overview"
  comes first for tracking budgets; the budget page moves under "More" (desktop)
  and down the tab grid (mobile).
- The month is in the URL (`/home?month=YYYY-MM`) so going back from a
  drill-down returns to it.

## Where each number comes from

- **Spending and income** come from one live query,
  `budgetSpendingByMonthQuery` in `loot-core/src/shared/budget-spending.ts`,
  over the selected month and the 11 before it. Its filters mirror the budget's
  `sum-amount` cells (`server/budget/base.ts`): on-budget, categorized, by
  budget date, projected installments included. Card charges therefore count in
  the month their bill is due, as on the budget page; a loot-core test checks
  the query against the sheet. The reports compute by transaction date and can
  disagree; the overview doesn't use them.
- **3-month average**: the three full months before, months without spending
  included, never before the first month with data.
- **Bills** (`bills/homeBills.ts`): schedule occurrences from
  `reports/reports/bills/billOccurrences.ts`, where a schedule that pays a card
  takes its status and amount from the card's own bill (a partial payment is
  not "paid"), plus the bills of cards no schedule pays.
- **Left after bills** (current month): cash account balances (on-budget, not
  cards) minus the bills still to pay this month. Balances already reflect
  everything spent, debit included. Expected income is shown apart. Other
  months show income minus spending.

## Paying a bill

The overview doesn't move money. "Record payment" (`bills/PayBillModal.tsx`)
shows the amount to copy into the bank's app, the due date and the paying
account, then records the payment (`bills/recordBillPayment.ts`):

- a schedule's bill posts the schedule with the amount, date and account paid
  (`schedule/post-transaction` accepts those overrides). A card-bill schedule
  posts a transfer, and the card is reconciled so its bill shows as paid;
- a card no schedule pays gets a transfer from the paying account.

The record is uncleared. When the bank sends the payment, bank sync matches it
on the exact amount within seven days (Pluggy accounts use the loose matching
mode) and keeps the recorded transaction, transfer and schedule link included,
on both the checking and the card side (`credit-cards/bank-sync.test.ts`,
"bill payments recorded by hand"). Until then the bill reads "Paid, waiting for
the bank".

Limits: a different amount or a bank date more than a week away leaves two
copies (the modal warns about both); another transaction of the same amount
nearby can be matched first; a payment before a card bill closes counts toward
the previous bill (the modal warns).

## Layout

- Wide (>= 1100px): summary tiles; bills and balances beside spending by
  category; both charts side by side.
- Medium: summary 2x2, bills and balances side by side, the rest stacked.
- Phones: stacked sections that collapse (`home.collapsedSections`), pull to
  refresh, the two charts behind a toggle.

Local prefs: `home.collapsed` (groups), `home.collapsedSections`,
`home.payFromAccount`, `home.trendRange`, `home.trendFilter`.

## Translations

Strings only the fork has are translated in
`packages/desktop-client/locale-fork/<language>.json` (keys are the English
strings). The loader merges them over the upstream translations, which are
cloned at build time and don't know them. Add new fork strings there.
