import { app as accountsApp } from '#server/accounts/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { runMutator } from '#server/mutators';

import { mergeDuplicateImports } from './duplicate-imports';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

async function rows(accountId: string) {
  return db.all<{ id: string; amount: number; category: string | null }>(
    `SELECT id, amount, category FROM transactions
     WHERE acct = ? AND tombstone = 0 ORDER BY id`,
    [accountId],
  );
}

describe('mergeDuplicateImports', () => {
  it('merges rows imported twice, keeping what the user set', async () => {
    const accountId = await accountsApp.handlers['account-create']({
      name: 'Conta',
    });
    const category = await runMutator(() =>
      db
        .insertCategoryGroup({ name: 'Group' })
        .then(group =>
          db.insertCategory({ name: 'Mercado', cat_group: group }),
        ),
    );
    await runMutator(async () => {
      await db.insertTransaction({
        id: 'a',
        account: accountId,
        date: '2026-10-13',
        amount: -11385,
        imported_id: 'bank-1',
      });
      await db.insertTransaction({
        id: 'b',
        account: accountId,
        date: '2026-10-13',
        amount: -11385,
        imported_id: 'bank-1',
        category,
      });
      await db.insertTransaction({
        id: 'c',
        account: accountId,
        date: '2026-10-13',
        amount: -500,
        imported_id: 'bank-2',
      });
    });

    expect(await runMutator(() => mergeDuplicateImports(accountId))).toBe(1);
    const remaining = await rows(accountId);
    expect(remaining).toHaveLength(2);
    expect(remaining.find(row => row.amount === -11385)?.category).toBe(
      category,
    );
    expect(await runMutator(() => mergeDuplicateImports(accountId))).toBe(0);
  });
});
