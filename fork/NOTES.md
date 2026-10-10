# Instance notes

Context about this particular Actual instance — the things that aren't derivable
from the code. Day-to-day finance conventions (what categories mean, people,
rule style) live in the connector's notebook, inside the budget itself, so every
Claude client reads the same copy; this file covers the instance.

## Instance

- Sync server: Railway service `actualbudget`, project `remarkable-empathy`,
  region `sfo`, `https://actualbudget-production-c3bf.up.railway.app`. Password
  login, single user.
- Budget: one file, "Duarte Finances". Not end-to-end encrypted. Budget type is
  **tracking**. Amounts are budgeted 12 months ahead (Oct 2026 – Sep 2027)
  because the Balance Forecast report projects from them; they are monthly
  averages, not envelopes.
- MCP connector: Railway service `actual-mcp`,
  `https://actual-mcp-production-fff5.up.railway.app/mcp` (`fork/RUNBOOK.md` §4).

## Accounts

All on-budget, all synced through Actual's built-in Pluggy.ai provider:

- **Inter Checking**: the main account. Its Pluggy consent has to be renewed on
  meu.pluggy.ai by scanning a QR code from the Inter app, so it stops syncing
  whenever nobody does that.
- **Inter Credit Card**: Pluggy reports future installments, so Actual's
  balance only matches the bank's when future-dated transactions are included.
- **Itaú Card 1**, **Itaú Card 2**: credit cards.

Card bill payments are transfers from Inter Checking. The card side also
imports a "Pagamento recebido" credit, which duplicates the transfer unless
it is merged into it. Itaú reports every bill payment twice under different
ids, and with Actual's default `sync-reimport-deleted-<account>` = `true` the
next bank sync re-imports whatever was merged away. That synced pref is set to
`false` for both Itaú cards; do the same for any account that needs merges.

Pluggy's reported balance for a card is the used limit, which includes
purchases authorized in the last day or two that Open Finance hasn't delivered
yet. Compare the card balance with the open bills, never adjust a starting
balance to match the used limit.

The credit card module stores card, bill and installment metadata in
`credit_card_*` tables and reads Actual's transactions as the ledger. It does
not insert projected installments and does not change an account balance. The
flag `creditCards` stays off until someone turns it on in Settings →
Experimental. Recovery if a stock Actual build refuses the budget is in
`fork/credit-cards/RECOVERY.md`.

## Categories

Portuguese names, grouped by area so the trend reports read well: Moradia,
Alimentação, Saúde, Transporte (includes the car financing), Casa e pessoal,
Assinaturas, Família, Impostos PJ (DAS, DARF, accountant only), Eventuais
(trips, equipment, leisure, card installments: lumpy spending kept out of the
cost-of-living curves), A receber, Trabalho, Outros; income group "Entradas"
with Faturamento PJ and Renda extra (never budgeted). The non-obvious ones (the
`A receber` receivable, which has carryover on; `Outros > Não faço ideia` as
the explicit unknown bucket) are explained in the notebook.

## Rules and automation

- Rules match on `notes contains <bank description fragment>`. Pluggy puts the
  bank description in notes and rarely sets a payee, which is why the
  notes/contains default patch exists. One rule per category, with an OR list
  of merchants.
- Schedules cover every bill the owner pays by hand (rent, health plan,
  energy, water, internet, both phone lines, accountant, DAS and DARF
  separately, car financing, both card bills as transfer schedules, and the
  boletos paid for Renata's family) plus expected income (two HTECH payments,
  two repayments from Renata's family). None auto-post. Actual only links a
  payment within two days of the expected date, so bills paid early or late
  stay unlinked until linked by hand; a daily scheduled Claude task does that
  for clear matches and pushes an alert about what is still open.
- The MCP connector talks to the API. Its daily job (06:00 BRT) exports a
  backup and runs bank sync.

## Reports

- Dashboard "Este mês" (the first page): the `bills-card` and
  `month-summary-card` widgets (fork patch, see `fork/PATCHES.md`), the month's
  income/spending/savings summary cards, spending vs budget, spending by
  group, the Balance Forecast (tracking-budget source, static range — the
  widget has no forward rolling window, so move it when budgeting new months),
  PJ taxes ÷ revenue, and a calendar.
- Dashboard "Tendências": custom reports with monthly curves per group.
- `bills-card` derives everything from schedules: each occurrence in the
  current month, matched to linked payments in a window halfway to the
  neighbouring occurrences; an unpaid occurrence before `next_date` counts as
  skipped and is hidden. Statuses reuse `getStatus` from
  `loot-core/src/shared/schedules.ts`, so they agree with the Schedules page.
- A schedule whose payee is a transfer to a Pluggy-synced credit card (a card
  bill) uses the card's closed bill (fatura) from Pluggy instead of the
  estimate: the bill due this month, otherwise the next unpaid one, shown with
  its due date. Pluggy only lists a bill once the card closes it; until then,
  or offline, the card falls back to the estimate. The connector's
  `get_card_bills` reads the same bills.
- `month-figure-card` shows one headline number (projected income, expenses or
  savings, or income received, spent or saved so far), picked from the card's
  context menu. It shares `monthSummary.ts` with the month summary, so
  "projected savings" matches the summary's "Projected for month end".
  Overspending leaves out rollover categories (A receber), as the budget page
  does.

## Working split

- Budget data (categorizing, rules, schedules, budgets, dashboards) is handled
  from claude.ai through the MCP connector; the notebook is the source of truth
  for those conventions.
- Code changes to this fork are made with Claude Code in this checkout. A
  claude.ai session that needs a code change should hand over a prompt rather
  than develop it there (PR #1 was the exception).

## Known issues

- `api/transaction-update` does not await its write (`loot-core/src/server/api.ts`).
  The connector works around it, and the one-line fix is worth sending upstream.
- `api/category-update` trims `name` unconditionally (`server/budget/app.ts`
  `updateCategory`), so a partial update without `name` throws. The connector
  sends the name along; an upstream fix is a one-liner.
- ActualQL reads only the first operator of a field object, so a date range
  written as one object with `$gte` and `$lte` silently drops the upper bound.
  Put each bound in its own entry of an `$and` array.
- The tracking Balance Forecast adds the current month's whole budget on top
  of a balance that already contains this month's actuals, so mid-month it
  runs high (`server/forecast/forecast-tracking-budget.ts`).
- Actual re-dates Pluggy card installments: PGZ installments show every two
  months through 2028 while the feed has them monthly through 2027-04.
  `getTransactionDateCorrected` in `app-pluggyai.js` is unchanged. The credit
  card module (flag `creditCards`, off) ignores that shifted date and reads
  `originalDate` plus `creditCardMetadata` from `raw_synced_data`. The account
  register still shows the shifted dates until that function is fixed on its
  own.

## History

- 2026-10-09: catch-up after the user's vacation (bank sync last ran 2026-09-11).
  Synced 79 transactions; merged two duplicated card payments and linked a third
  as a transfer; linked seven paid-but-unlinked schedule payments (Algar, car
  financing, Cyta, DARF/DAS) and advanced their next dates; fixed the Santander
  and Trucks rules after the bank changed its descriptions; filed 33 UK-trip
  transactions under Viagem em família. Backups and an audit log of each change
  are in `~/.local/share/actual-claude/` on the dev machine.
- 2026-10-09 (claude.ai): Itaú Card 1 starting balance corrected (it had
  absorbed a purchase that synced later); `sync-reimport-deleted` turned off
  for both Itaú cards; categories regrouped; schedules completed; dashboards
  "Este mês" and "Tendências" built; PR #1 merged and deployed: `bills-card`,
  `month-summary-card`, MCP `get_budget`/`manage_budget`, fixes to
  `move_category`/`set_hidden` and `replace_section`.
