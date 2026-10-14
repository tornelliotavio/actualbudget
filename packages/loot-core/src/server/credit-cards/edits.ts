import * as db from '#server/db';
import type { TransactionEntity } from '#types/models';

import { reconcileCardAccount } from './reconcile';

/**
 * Brings the card accounts a user edit touched back in line: a transaction
 * added by hand gets its bill, and a changed installment its projections.
 * A transfer's other half counts, since editing one half changes both.
 */
export async function reconcileCardsTouchedBy(
  transactionIds: Array<TransactionEntity['id']>,
) {
  if (transactionIds.length === 0) {
    return;
  }
  const placeholders = transactionIds.map(() => '?').join(', ');
  const cards = await db.all<{ acct: string }>(
    `SELECT DISTINCT t.acct FROM transactions t
     JOIN accounts a ON a.id = t.acct
     WHERE a.kind = 'credit_card'
       AND (t.id IN (${placeholders}) OR t.transferred_id IN (${placeholders}))`,
    [...transactionIds, ...transactionIds],
  );
  for (const { acct } of cards) {
    await reconcileCardAccount(acct);
  }
}
