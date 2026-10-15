import * as db from '#server/db';
import type { AccountEntity, TransactionEntity } from '#types/models';

import { reconcileCardAccount } from './reconcile';

export const CARD_COLUMNS = {
  card_bill: null,
  card_bill_source: null,
  card_kind: null,
  card_purchase: null,
  installment_number: null,
  installment_count: null,
  budget_date: null,
  projected: false,
};

/**
 * Card accounts the given transactions are in, a transfer's other half
 * included, since editing one half changes both.
 */
export async function cardAccountsOf(
  transactionIds: Array<TransactionEntity['id']>,
): Promise<Set<AccountEntity['id']>> {
  if (transactionIds.length === 0) {
    return new Set();
  }
  const placeholders = transactionIds.map(() => '?').join(', ');
  const rows = await db.all<{ acct: string }>(
    `SELECT DISTINCT t.acct FROM transactions t
     JOIN accounts a ON a.id = t.acct
     WHERE a.kind = 'credit_card'
       AND (t.id IN (${placeholders}) OR t.transferred_id IN (${placeholders}))`,
    [...transactionIds, ...transactionIds],
  );
  return new Set(rows.map(row => row.acct));
}

/**
 * Brings the card accounts a user edit touched back in line: a transaction
 * added by hand gets its bill, a changed installment its projections. A
 * transaction moved out of a card loses its bill and budget date, and the
 * card it left is reconciled too. `cardsBefore` are the cards the edited
 * transactions were in before the edit.
 */
export async function reconcileCardsTouchedBy(
  transactionIds: Array<TransactionEntity['id']>,
  cardsBefore: ReadonlySet<AccountEntity['id']> = new Set(),
) {
  if (transactionIds.length === 0 && cardsBefore.size === 0) {
    return;
  }
  if (transactionIds.length > 0) {
    const placeholders = transactionIds.map(() => '?').join(', ');
    const leftCard = await db.all<{ id: string }>(
      `SELECT t.id FROM transactions t
       JOIN accounts a ON a.id = t.acct
       WHERE t.id IN (${placeholders})
         AND IFNULL(a.kind, 'standard') != 'credit_card'
         AND (t.card_bill IS NOT NULL OR t.budget_date IS NOT NULL
              OR t.projected = 1)`,
      transactionIds,
    );
    for (const { id } of leftCard) {
      await db.updateTransaction({ id, ...CARD_COLUMNS });
    }
  }

  const cards = new Set([
    ...cardsBefore,
    ...(await cardAccountsOf(transactionIds)),
  ]);
  for (const accountId of cards) {
    await reconcileCardAccount(accountId);
  }
}
