import { app as accountsApp } from '#server/accounts/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { runMutator } from '#server/mutators';
import { loadRules } from '#server/transactions/transaction-rules';

import { dismissImportedTransactions } from './dismiss-imported';
import { reconcileTransactions } from './sync';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
});

async function aliveIds(accountId: string) {
  const rows = await db.all<{ id: string }>(
    'SELECT id FROM transactions WHERE acct = ? AND tombstone = 0 ORDER BY id',
    [accountId],
  );
  return rows.map(row => row.id);
}

function bankRow(transactionId: string, amount: number) {
  return {
    transactionId,
    date: '2026-11-16',
    payeeName: '',
    notes: 'Rendimentos',
    booked: true,
    transactionAmount: { amount, currency: 'BRL' },
  };
}

async function setup() {
  const accountId = await accountsApp.handlers['account-create']({
    name: 'Conta',
  });
  await runMutator(async () => {
    await db.insertTransaction({
      id: 'mirror',
      account: accountId,
      date: '2026-11-16',
      amount: 77,
      imported_id: 'bank-mirror',
    });
    await db.insertTransaction({
      id: 'real',
      account: accountId,
      date: '2026-11-16',
      amount: -3089,
      imported_id: 'bank-real',
    });
    await db.insertTransaction({
      id: 'manual',
      account: accountId,
      date: '2026-11-16',
      amount: -500,
    });
  });
  return accountId;
}

describe('dismissImportedTransactions', () => {
  it('deletes the row and keeps bank sync from bringing it back', async () => {
    const accountId = await setup();

    await runMutator(() => dismissImportedTransactions({ ids: ['mirror'] }));
    expect(await aliveIds(accountId)).toEqual(['manual', 'real']);

    await runMutator(() =>
      reconcileTransactions(
        accountId,
        [bankRow('bank-mirror', 0.77), bankRow('bank-real', -30.89)],
        { isBankSyncAccount: true },
      ),
    );
    expect(await aliveIds(accountId)).toEqual(['manual', 'real']);
  });

  it('differs from a plain delete, which the next sync undoes', async () => {
    const accountId = await setup();

    await runMutator(() => db.deleteTransaction({ id: 'mirror' }));
    await runMutator(() =>
      reconcileTransactions(accountId, [bankRow('bank-mirror', 0.77)], {
        isBankSyncAccount: true,
      }),
    );
    expect(await aliveIds(accountId)).toHaveLength(3);
  });

  it('refuses rows the bank did not send, and changes nothing', async () => {
    const accountId = await setup();

    await expect(
      runMutator(() =>
        dismissImportedTransactions({ ids: ['mirror', 'manual'] }),
      ),
    ).rejects.toThrow('was not imported');
    expect(await aliveIds(accountId)).toEqual(['manual', 'mirror', 'real']);
  });

  it('refuses transfers', async () => {
    const accountId = await setup();
    const other = await accountsApp.handlers['account-create']({
      name: 'Outra',
    });
    await runMutator(async () => {
      await db.insertTransaction({
        id: 'out',
        account: accountId,
        date: '2026-11-16',
        amount: -1000,
        imported_id: 'bank-out',
        transfer_id: 'in',
      });
      await db.insertTransaction({
        id: 'in',
        account: other,
        date: '2026-11-16',
        amount: 1000,
        transfer_id: 'out',
      });
    });

    await expect(
      runMutator(() => dismissImportedTransactions({ ids: ['out'] })),
    ).rejects.toThrow('is a transfer');
  });
});
