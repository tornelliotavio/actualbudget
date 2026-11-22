import { suppressImport } from '#server/credit-cards/store';
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import type { TransactionEntity } from '#types/models';

type DismissableRow = {
  id: string;
  acct: string;
  financial_id: string | null;
  transferred_id: string | null;
  isParent: number;
  isChild: number;
  tombstone: number;
};

function refusal(row: DismissableRow | undefined, id: string) {
  if (!row || row.tombstone) {
    return `Transaction ${id} does not exist.`;
  }
  if (!row.financial_id) {
    return `Transaction ${id} was not imported from the bank.`;
  }
  if (row.transferred_id) {
    return `Transaction ${id} is a transfer.`;
  }
  if (row.isParent || row.isChild) {
    return `Transaction ${id} is split.`;
  }
  return null;
}

/**
 * Deletes bank-imported transactions and keeps bank sync from importing them
 * again. Only plain imported rows qualify: deleting a transfer or a split
 * would take its other side or parts with it.
 */
export async function dismissImportedTransactions({
  ids,
}: {
  ids: Array<TransactionEntity['id']>;
}): Promise<{ dismissed: Array<TransactionEntity['id']> }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return { dismissed: [] };
  }
  const rows = await db.all<DismissableRow>(
    `SELECT id, acct, financial_id, transferred_id, isParent, isChild,
            tombstone
     FROM transactions WHERE id IN (${unique.map(() => '?').join(', ')})`,
    unique,
  );
  const byId = new Map(rows.map(row => [row.id, row]));
  const dismissals = unique.map(id => {
    const row = byId.get(id);
    const problem = refusal(row, id);
    if (problem || !row?.financial_id) {
      throw new Error(problem ?? `Transaction ${id} cannot be dismissed.`);
    }
    return { id, account: row.acct, importedId: row.financial_id };
  });

  await batchMessages(async () => {
    for (const { id, account, importedId } of dismissals) {
      await suppressImport(account, importedId, 'dismissed');
      await db.deleteTransaction({ id });
    }
  });
  return { dismissed: unique };
}
