# Native credit cards

A credit card is an account of kind `credit_card`. Its balance is what the card
owes (negative), projected installments included, so it matches the limit the
bank has blocked. Bills (faturas), installments and bill payments are derived
from the card's transactions and the facts Pluggy sends with each sync; editing
by hand is only an override.

Code: `packages/loot-core/src/server/credit-cards/`. The pure rules live in
`engine/` (no database access, unit tested); the files next to it load state,
write it through CRDT and hook into bank sync.

## Concepts

**Bill month.** A bill is named after the month it is due in: "the October
bill" is due in October. Its id is `<account id>:<YYYY-MM>`.

**Schedule.** Closing day and due day, from the user's settings, otherwise the
bank (`card_profiles.*_provider`, filled from Pluggy's `creditData`). A due day
before the closing day means the bill closes in the previous month. Due dates
on weekends and bank holidays move to the next business day
(`engine/calendar.ts`, national holidays including Carnaval, Good Friday and
Corpus Christi); the nominal date still names the bill.

**Which bill a transaction is on.** In order:

1. a bill the user pinned (`card_bill_source = 'user'`);
2. a bill payment pays the bill that closed most recently before it;
3. Pluggy's `billId`, when the bank sent the bill;
4. Pluggy's `billPostDate`: banks bill a charge by the day it posts, which can
   be after the closing day for a purchase made before it;
5. the purchase date against the schedule. A purchase on the closing day goes
   to the next bill unless the card's settings say otherwise.

Installments are spread from their purchase: installment _n_ of a purchase
whose first installment is on bill _M_ is on bill _M + n − 1_.

**Purchases and projections.** Installments of one purchase are grouped in
`card_purchases` (key: description stem, count, card, first bill). Missing
installments are inserted as projected transactions (`projected = 1`) with
deterministic ids, so two devices create the same rows. When the real
installment arrives the projection is removed. A refund of the purchase
cancels the projections. A projection the user deletes is never recreated.

**Bill totals** follow the issuer's statement: previous bill's total, minus
payments made during this cycle, plus this bill's charges. The bank's total
replaces the computed one when Pluggy sends it, and the difference is shown.
Statuses: upcoming, open, closed, partially paid, paid, overdue. A refund that
posts after closing settles the shortfall it caused. A cycle the synced history
starts in the middle of is marked incomplete; once paid it is not shown as
overdue, and only an overpayment carries forward from it.

**Finance charges.** When a closed bill's bank total exceeds its transactions
by exactly the interest, IOF and fees the bank itemized, one charge dated on
closing makes up the difference (`card_bill_source = 'adjustment'`). It goes
away when the charges arrive as transactions, is not recreated after the user
deletes it, and is never made for bills closed before the card became a card
account (`card_profiles.adjustments_from`), which its starting balance covers.

**Bill payments.** A payment credit on the card is linked to the matching
debit in another account and both become one transfer. The debit must be the
only one with the same amount within five days that is imported, not
reconciled, not part of a split, on the same side of the budget, and
uncategorized or linked to a schedule that pays the card; a schedule that pays the card within fifteen
days is marked paid by it. When the checking side was already a transfer whose
card half was created locally, the imported credit replaces that half.

**Transfers between the user's accounts** (`accounts/transfer-links.ts`, after
the card payments). An imported debit and an imported credit of the same
amount in two accounts on the same side of the budget, within two days, both
uncategorized and described as a transfer (Pix, TED, DOC, "Pagamento Fatura",
or that Pluggy operation type), become one transfer when each is the only
candidate for the other. A bank copy of a transfer entered by hand or posted
by a schedule replaces that transfer.

**Budget.** Card charges count in the month their bill is due
(`transactions.budget_date`); everything else in the month of its date. The
category drill-down from the budget filters by budget month.

## Data model

Migration `1792008316315_native_credit_cards.sql`.

| Where                                  | What                                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts.kind`                        | `standard` or `credit_card`.                                                                                                                                                      |
| `transactions.card_*`                  | `card_bill` (bill id), `card_bill_source` (`user`, `provider`, `installment`, `cycle`, `adjustment`), `card_kind` (purchase, installment, payment, credit, fee), `card_purchase`. |
| `transactions.installment_*`           | Installment number and count.                                                                                                                                                     |
| `transactions.projected`               | 1 on projected installments.                                                                                                                                                      |
| `transactions.budget_date`             | Day the budget counts the transaction; null means its date.                                                                                                                       |
| `transactions.bank_sync_missing_since` | Pending card charges the bank stopped returning; removed after three days.                                                                                                        |
| `card_profiles`                        | One per card (id = account id): closing and due days from the bank and the user, closing-day rule, limit, payment descriptions, `adjustments_from`.                               |
| `card_bills`                           | One per bill the bank or the user described: dates, total, minimum, finance charges and payments from Pluggy; dates and total set by the user.                                    |
| `card_purchases`                       | Installment purchases and their status: active, kept (resumed by the user; refunds no longer cancel it), cancelled (by a refund), dismissed (stopped by the user).                |
| `bank_sync_suppressions`               | Imported ids bank sync must not insert again.                                                                                                                                     |

Every write goes through CRDT. Reconciliation is idempotent: a second run
writes nothing.

## When reconciliation runs

- after each bank sync of a card (`bank-sync.ts`), followed by payment linking
  across all accounts;
- after transactions are added, edited or deleted through the transaction
  handlers (`edits.ts`), for every card involved, the card half of a transfer
  included;
- after a settings change, a pinned bill, a purchase status change or a bill
  override (`app.ts`).

After the first reconciliation a date the user set on a card transaction is
kept; installment dates keep following their bills.

## Pluggy, per bank

Seen in the 2026-10-14 export.

| Card                  | Closes | Due | Notes                                                                                                                                                                                                                    |
| --------------------- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cartão Inter PF       | 4      | 10  | `billPostDate` is the posting date; charges posted on the closing day are on the closing bill. Payments: `PAGAMENTO ON LINE`, `PAGTO DEBITO AUTOMATICO`. Direct connector, yet the balance includes future installments. |
| Cartão MercadoPago PF | 5      | 10  | `billPostDate` is the closing date. Payments: `Pagamento recebido` with operation type `PAGAMENTO_FATURA`. A payment beyond what a bill asks for carries to the next bill as a credit.                                   |

Pluggy reports a card's used limit as its balance, future installments
included, for direct and Open Finance connectors alike. A first link therefore
takes the projected installments out of the starting balance it derives from
that balance. A card linked before card support became a card account later and
kept a starting balance that already counted them; those were fixed by hand
(Cartão Inter PF, 2026-10-15).

`billId` only comes on posted transactions. `billForecastDate` is inconsistent
between banks and not used. `pluggy-sdk` turns ISO date strings into `Date`
objects; the sync server keeps them as ISO strings so `purchaseDate` survives.

## Where it shows

- The card account page: one bill at a time with its total, projected
  installments, payments, dates, status and the limit used; the register can
  list only that bill's transactions. Mobile shows the same panel.
- The selection menu of card transactions: move to the previous or next bill,
  back to automatic, stop or resume projected installments.
- Card settings: closing and due days, closing-day purchases, limit, bill
  payment descriptions.
- The credit cards page (`/cards`): every card's next six bills and the total
  per month.
- The bills report card and the MCP tool `get_card_bills`.
