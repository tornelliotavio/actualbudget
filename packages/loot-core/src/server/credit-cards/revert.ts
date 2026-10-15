import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import type { AccountEntity } from '#types/models';

import { CARD_COLUMNS } from './edits';
import { makeStandardAccount } from './profiles';

/**
 * Turns a card account back into a regular account and drops what the card
 * derived. Projected installments and finance charge adjustments are removed
 * the way reconciliation removes them, so turning the account into a card
 * again recreates them. Every other transaction loses its bill, installment
 * data and budget date, and counts in the month of its date again.
 */
export async function revertCreditCardAccount(
  accountId: AccountEntity['id'],
): Promise<void> {
  const rows = await db.all<{
    id: string;
    projected: number | null;
    card_bill_source: string | null;
  }>(
    `SELECT id, projected, card_bill_source FROM transactions
     WHERE acct = ? AND tombstone = 0
       AND (card_bill IS NOT NULL OR card_bill_source IS NOT NULL
            OR card_kind IS NOT NULL OR card_purchase IS NOT NULL
            OR installment_number IS NOT NULL OR installment_count IS NOT NULL
            OR budget_date IS NOT NULL OR projected = 1)`,
    [accountId],
  );

  await batchMessages(async () => {
    await makeStandardAccount(accountId);
    for (const row of rows) {
      await db.updateTransaction({ id: row.id, ...CARD_COLUMNS });
      if (row.projected || row.card_bill_source === 'adjustment') {
        await db.deleteTransaction({ id: row.id });
      }
    }
  });
}
