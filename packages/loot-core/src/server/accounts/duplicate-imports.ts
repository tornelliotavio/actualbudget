import { logger } from '#platform/server/log';
import * as db from '#server/db';
import { mergeTransactions } from '#server/transactions/merge';
import type { AccountEntity } from '#types/models';

type ImportedRow = {
  id: string;
  financial_id: string;
  amount: number;
  transferred_id: string | null;
  description: string | null;
};

const COLUMNS = 'id, financial_id, amount, transferred_id, description';

function readRow(id: string) {
  return db.first<ImportedRow>(
    `SELECT ${COLUMNS} FROM transactions WHERE id = ?`,
    [id],
  );
}

function transfersElsewhere(a: ImportedRow, b: ImportedRow) {
  return (
    a.transferred_id != null &&
    b.transferred_id != null &&
    a.description !== b.description
  );
}

/**
 * Two devices syncing the same account at once could each insert a bank
 * transaction before imported rows got deterministic ids. Rows sharing an
 * imported id are one bank transaction, so they are merged into one,
 * keeping whatever the user set on either.
 */
export async function mergeDuplicateImports(
  accountId: AccountEntity['id'],
): Promise<number> {
  const rows = await db.all<ImportedRow>(
    `SELECT ${COLUMNS} FROM transactions
     WHERE acct = ? AND tombstone = 0 AND isChild = 0
       AND financial_id IN (
         SELECT financial_id FROM transactions
         WHERE acct = ? AND tombstone = 0 AND isChild = 0
           AND financial_id IS NOT NULL
         GROUP BY financial_id HAVING COUNT(*) > 1
       )
     ORDER BY financial_id, id`,
    [accountId, accountId],
  );

  const groups = new Map<string, ImportedRow[]>();
  for (const row of rows) {
    groups.set(row.financial_id, [
      ...(groups.get(row.financial_id) ?? []),
      row,
    ]);
  }

  let merged = 0;
  for (const [importedId, [first, ...rest]] of groups) {
    let kept = first;
    for (const other of rest) {
      if (transfersElsewhere(kept, other)) {
        // Transfers to two different accounts: which one is right is the
        // user's call.
        logger.warn('Duplicate bank import left alone', importedId);
        continue;
      }
      if (other.amount !== kept.amount) {
        // The bank changed the amount between the two inserts; the next
        // sync writes the current one onto the row that remains.
        await db.updateTransaction({ id: other.id, amount: kept.amount });
      }
      const keptId = await mergeTransactions([kept, other]);
      kept = (await readRow(keptId)) ?? kept;
      merged++;
    }
  }
  if (merged > 0) {
    logger.log('Merged duplicate bank imports', accountId, merged);
  }
  return merged;
}
