import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { q } from '#shared/query';
import type {
  AccountEntity,
  CardBillEntity,
  CardProfileEntity,
  CardPurchaseEntity,
  TransactionEntity,
} from '#types/models';

/** Everything the reconciliation reads about one credit card account. */
export type CardAccountState = {
  account: AccountEntity;
  profile: CardProfileEntity | null;
  bills: CardBillEntity[];
  purchases: CardPurchaseEntity[];
  /**
   * Alive transactions of the account as the bank sees them: a split
   * transaction is its parent, whose amount is the sum of its parts.
   */
  transactions: TransactionEntity[];
  /** Parts of split transactions; they follow their parent's bill. */
  splitChildren: TransactionEntity[];
  /** Projected rows that were deleted, alive or not in storage anymore. */
  deletedProjectedIds: Set<string>;
};

export async function loadAccount(
  accountId: AccountEntity['id'],
): Promise<AccountEntity | null> {
  const { data } = await aqlQuery(
    q('accounts').filter({ id: accountId }).select('*'),
  );
  return (data[0] as AccountEntity | undefined) ?? null;
}

export async function loadCardAccountState(
  accountId: AccountEntity['id'],
): Promise<CardAccountState | null> {
  const account = await loadAccount(accountId);
  if (!account || account.kind !== 'credit_card') {
    return null;
  }

  const [
    profiles,
    bills,
    purchases,
    transactions,
    splitChildren,
    deleted,
    suppressed,
  ] = await Promise.all([
    aqlQuery(q('card_profiles').filter({ id: accountId }).select('*')),
    aqlQuery(q('card_bills').filter({ account: accountId }).select('*')),
    aqlQuery(q('card_purchases').filter({ account: accountId }).select('*')),
    aqlQuery(
      q('transactions')
        .filter({ account: accountId })
        .options({ splits: 'none' })
        .select('*'),
    ),
    aqlQuery(
      q('transactions')
        .filter({ account: accountId, is_child: true })
        .options({ splits: 'inline' })
        .select('*'),
    ),
    db.all<{ id: string }>(
      'SELECT id FROM transactions WHERE acct = ? AND projected = 1 AND tombstone = 1',
      [accountId],
    ),
    db.all<{ imported_id: string }>(
      "SELECT imported_id FROM bank_sync_suppressions WHERE account = ? AND reason = 'projected-deleted' AND tombstone = 0",
      [accountId],
    ),
  ]);

  return {
    account,
    profile: (profiles.data[0] as CardProfileEntity | undefined) ?? null,
    bills: bills.data as CardBillEntity[],
    purchases: purchases.data as CardPurchaseEntity[],
    transactions: transactions.data as TransactionEntity[],
    splitChildren: splitChildren.data as TransactionEntity[],
    deletedProjectedIds: new Set([
      ...deleted.map(row => row.id),
      ...suppressed.map(row => row.imported_id),
    ]),
  };
}

export async function suppressImport(
  accountId: AccountEntity['id'],
  importedId: string,
  reason: 'projected-deleted' | 'duplicate' | 'replaced',
) {
  const id = `${accountId}:${importedId}`;
  const existing = await db.first<{ tombstone: number }>(
    'SELECT tombstone FROM bank_sync_suppressions WHERE id = ?',
    [id],
  );
  if (existing && !existing.tombstone) {
    return;
  }
  await db.insert('bank_sync_suppressions', {
    id,
    account: accountId,
    imported_id: importedId,
    reason,
    tombstone: 0,
  });
}

export async function getSuppressedImports(
  accountId: AccountEntity['id'],
): Promise<Set<string>> {
  const rows = await db.all<{ imported_id: string }>(
    'SELECT imported_id FROM bank_sync_suppressions WHERE account = ? AND tombstone = 0',
    [accountId],
  );
  return new Set(rows.map(row => row.imported_id));
}
