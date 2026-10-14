import { logger } from '#platform/server/log';
import * as db from '#server/db';
import { mergeTransactions } from '#server/transactions/merge';
import type { AccountEntity } from '#types/models';

type ImportedRow = {
  id: string;
  financial_id: string;
  date: number;
  amount: number;
  notes: string | null;
  imported_description: string | null;
  raw_synced_data: string | null;
};

/** What bank sync wrote; a copy the user edited differs in one of these. */
function importSignature(row: ImportedRow) {
  // Older imports stored a missing description as '' or as null.
  return JSON.stringify([
    row.date,
    row.amount,
    row.notes || null,
    row.imported_description || null,
    row.raw_synced_data || null,
  ]);
}

/**
 * Two devices syncing the same account at once could each insert a bank
 * transaction before imported rows got deterministic ids. Those copies are
 * identical to the field, and are merged into one, keeping whatever the user
 * set on either. A copy the user made and changed (Duplicate keeps the
 * imported id) differs from the original and is left alone; split
 * transactions are never touched.
 */
export async function mergeDuplicateImports(
  accountId: AccountEntity['id'],
): Promise<number> {
  const rows = await db.all<ImportedRow>(
    `SELECT id, financial_id, date, amount, notes, imported_description,
            raw_synced_data
     FROM transactions
     WHERE acct = ? AND tombstone = 0 AND isChild = 0 AND isParent = 0
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
    const key = `${row.financial_id}|${importSignature(row)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  let merged = 0;
  for (const group of groups.values()) {
    let keptId = group[0].id;
    for (const other of group.slice(1)) {
      try {
        keptId = await mergeTransactions([{ id: keptId }, { id: other.id }]);
        merged++;
      } catch (error) {
        // Transfers to two different accounts: which one is right is the
        // user's call.
        logger.warn('Duplicate bank import left alone', other.id, error);
      }
    }
  }
  if (merged > 0) {
    logger.log('Merged duplicate bank imports', accountId, merged);
  }
  return merged;
}
