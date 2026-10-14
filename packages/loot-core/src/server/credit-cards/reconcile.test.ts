import { app as accountsApp } from '#server/accounts/app';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { runMutator } from '#server/mutators';
import { addSyncListener } from '#server/sync';
import { app as transactionsApp } from '#server/transactions/app';
import type { TransactionEntity } from '#types/models';

import { app } from './app';
import { getCardBills } from './bills';
import { reconcileCardAccount } from './reconcile';

const TODAY = '2026-10-14';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
});

async function createCard() {
  return accountsApp.handlers['account-create']({
    name: 'Cartão',
    kind: 'credit_card',
    card: { closingDay: 5, dueDay: 12 },
  });
}

function pluggyRaw(fields: Record<string, unknown>) {
  return JSON.stringify({
    status: 'POSTED',
    booked: true,
    operationType: 'PAGAMENTO',
    ...fields,
  });
}

async function addTransaction(fields: Record<string, unknown>) {
  return runMutator(() => db.insertTransaction({ cleared: true, ...fields }));
}

async function cardRows(accountId: string) {
  return db.all<{
    id: string;
    date: number;
    amount: number;
    card_bill: string | null;
    card_kind: string | null;
    card_purchase: string | null;
    installment_number: number | null;
    projected: number;
    budget_date: number | null;
    category: string | null;
    tombstone: number;
  }>(
    `SELECT id, date, amount, card_bill, card_kind, card_purchase,
            installment_number, projected, budget_date, category, tombstone
     FROM transactions WHERE acct = ? ORDER BY date, id`,
    [accountId],
  );
}

describe('reconcileCardAccount', () => {
  it('creates card accounts with a profile', async () => {
    const id = await createCard();
    const account = await db.first<{ kind: string }>(
      'SELECT kind FROM accounts WHERE id = ?',
      [id],
    );
    expect(account?.kind).toBe('credit_card');
    const profile = await db.first<{ closing_day_user: number }>(
      'SELECT closing_day_user FROM card_profiles WHERE id = ?',
      [id],
    );
    expect(profile?.closing_day_user).toBe(5);
  });

  it('assigns bills, budget dates and projects installments', async () => {
    const accountId = await createCard();
    const group = await db.insertCategoryGroup({ name: 'Despesas' });
    const category = await db.insertCategory({
      name: 'Casa',
      cat_group: group,
    });
    await addTransaction({
      id: 'first',
      account: accountId,
      date: '2026-10-10',
      amount: -10000,
      category,
      notes: 'LOJA X',
      imported_id: 'pluggy-1',
      raw_synced_data: pluggyRaw({
        description: 'LOJA X',
        originalDate: '2026-10-10',
        date: '2026-10-10',
        'creditCardMetadata.installmentNumber': 1,
        'creditCardMetadata.totalInstallments': 6,
      }),
    });

    const result = await runMutator(() =>
      reconcileCardAccount(accountId, { today: TODAY }),
    );
    expect(result.status).toBe('ok');

    const rows = await cardRows(accountId);
    expect(rows).toHaveLength(6);
    const [first, ...projected] = rows;
    expect(first).toMatchObject({
      id: 'first',
      card_bill: `${accountId}:2026-11`,
      card_kind: 'installment',
      installment_number: 1,
      projected: 0,
      budget_date: 20261112,
    });
    expect(
      projected.map(row => [
        row.date,
        row.card_bill,
        row.installment_number,
        row.projected,
        row.budget_date,
        row.category,
      ]),
    ).toEqual([
      [20261110, `${accountId}:2026-12`, 2, 1, 20261212, category],
      [20261210, `${accountId}:2027-01`, 3, 1, 20270112, category],
      [20270110, `${accountId}:2027-02`, 4, 1, 20270212, category],
      [20270210, `${accountId}:2027-03`, 5, 1, 20270312, category],
      [20270310, `${accountId}:2027-04`, 6, 1, 20270412, category],
    ]);
    expect(new Set(rows.map(row => row.card_purchase)).size).toBe(1);

    const purchases = await db.all<{ anchor_month: string; status: string }>(
      'SELECT anchor_month, status FROM card_purchases WHERE account = ?',
      [accountId],
    );
    expect(purchases).toEqual([{ anchor_month: '2026-11', status: 'active' }]);
  });

  it('writes nothing on a second run', async () => {
    const accountId = await createCard();
    await addTransaction({
      id: 'first',
      account: accountId,
      date: '2026-10-10',
      amount: -10000,
      notes: 'LOJA X',
      imported_id: 'pluggy-1',
      raw_synced_data: pluggyRaw({
        originalDate: '2026-10-10',
        date: '2026-10-10',
        'creditCardMetadata.installmentNumber': 1,
        'creditCardMetadata.totalInstallments': 3,
      }),
    });
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    const before = await db.all('SELECT * FROM transactions ORDER BY id');
    const written: string[] = [];
    const stopListening = addSyncListener((_, newValues) => {
      written.push(...newValues.keys());
    });

    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    stopListening();

    expect(await db.all('SELECT * FROM transactions ORDER BY id')).toEqual(
      before,
    );
    expect(written).toEqual([]);
  });

  it('does not recreate a projected installment the user deleted', async () => {
    const accountId = await createCard();
    await addTransaction({
      id: 'first',
      account: accountId,
      date: '2026-10-10',
      amount: -10000,
      notes: 'LOJA X',
      imported_id: 'pluggy-1',
      raw_synced_data: pluggyRaw({
        originalDate: '2026-10-10',
        date: '2026-10-10',
        'creditCardMetadata.installmentNumber': 1,
        'creditCardMetadata.totalInstallments': 3,
      }),
    });
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    const [, second] = await cardRows(accountId);
    await runMutator(() => db.deleteTransaction({ id: second.id }));

    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));

    const alive = (await cardRows(accountId)).filter(row => !row.tombstone);
    expect(alive.map(row => row.installment_number)).toEqual([1, 3]);
    const suppression = await db.first<{ reason: string }>(
      'SELECT reason FROM bank_sync_suppressions WHERE imported_id = ?',
      [second.id],
    );
    expect(suppression?.reason).toBe('projected-deleted');
  });

  it('reports the bills of the card', async () => {
    const accountId = await createCard();
    await addTransaction({
      id: 'purchase',
      account: accountId,
      date: '2026-10-20',
      amount: -125000,
      notes: 'MERCADO',
    });
    await addTransaction({
      id: 'payment',
      account: accountId,
      date: '2026-11-11',
      amount: 50000,
      notes: 'Pagamento recebido',
    });
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));

    const result = await getCardBills(accountId, { today: TODAY });
    expect(result.status).toBe('ok');
    const november = result.bills.find(
      bill => bill.referenceMonth === '2026-11',
    );
    expect(november).toMatchObject({
      total: 125000,
      status: 'open',
      dueDate: '2026-11-12',
    });
    expect(result.currentMonth).toBe('2026-11');
  });

  it('lets the user move a transaction to another bill', async () => {
    const accountId = await createCard();
    await addTransaction({
      id: 'purchase',
      account: accountId,
      date: '2026-10-20',
      amount: -1000,
      notes: 'MERCADO',
    });
    await app.handlers['credit-card-transaction-bill']({
      id: 'purchase',
      referenceMonth: '2026-12',
    });
    const [row] = await cardRows(accountId);
    expect(row.card_bill).toBe(`${accountId}:2026-12`);
    expect(row.budget_date).toBe(20261212);
  });

  it('needs a closing and a due day', async () => {
    const accountId = await accountsApp.handlers['account-create']({
      name: 'Cartão sem dias',
      kind: 'credit_card',
    });
    const result = await runMutator(() =>
      reconcileCardAccount(accountId, { today: TODAY }),
    );
    expect(result.status).toBe('needs-schedule');
  });

  it('charges finance charges the bank only listed on the bill', async () => {
    const accountId = await createCard();
    await addTransaction({
      id: 'purchase',
      account: accountId,
      date: '2026-09-20',
      amount: -100000,
      notes: 'MERCADO',
    });
    await runMutator(() =>
      db.insertWithSchema('card_bills', {
        id: `${accountId}:2026-10`,
        account: accountId,
        reference_month: '2026-10',
        provider_total: 102350,
        provider_finance_charges: 2350,
      }),
    );
    const adjustments = () =>
      db.all<{ amount: number; card_bill: string; tombstone: number }>(
        `SELECT amount, card_bill, tombstone FROM transactions
         WHERE acct = ? AND card_bill_source = 'adjustment'`,
        [accountId],
      );

    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    expect(await adjustments()).toEqual([
      { amount: -2350, card_bill: `${accountId}:2026-10`, tombstone: 0 },
    ]);
    const [bill] = (await getCardBills(accountId, { today: TODAY })).bills;
    expect(bill).toMatchObject({ referenceMonth: '2026-10', divergence: 0 });

    await addTransaction({
      id: 'iof',
      account: accountId,
      date: '2026-10-03',
      amount: -2350,
      notes: 'IOF',
    });
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    expect(await adjustments()).toEqual([]);
  });

  it('does not recreate a finance charge adjustment the user deleted', async () => {
    const accountId = await createCard();
    await addTransaction({
      account: accountId,
      date: '2026-09-20',
      amount: -100000,
      notes: 'MERCADO',
    });
    await runMutator(() =>
      db.insertWithSchema('card_bills', {
        id: `${accountId}:2026-10`,
        account: accountId,
        reference_month: '2026-10',
        provider_total: 102350,
        provider_finance_charges: 2350,
      }),
    );
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    const row = await db.first<{ id: string }>(
      "SELECT id FROM transactions WHERE card_bill_source = 'adjustment'",
    );
    await runMutator(() => db.deleteTransaction({ id: row!.id }));
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    expect(
      await db.all(
        `SELECT id FROM transactions
         WHERE card_bill_source = 'adjustment' AND tombstone = 0`,
      ),
    ).toEqual([]);
  });

  it('reconciles a card when the user edits its transactions', async () => {
    const accountId = await createCard();
    await transactionsApp.handlers['transaction-add']({
      id: 'manual',
      account: accountId,
      date: '2026-10-10',
      amount: -5000,
    } as TransactionEntity);
    const [added] = await cardRows(accountId);
    expect(added.card_bill).toBe(`${accountId}:2026-11`);

    await transactionsApp.handlers['transaction-update']({
      id: 'manual',
      date: '2026-11-07',
    } as TransactionEntity);
    const [moved] = await cardRows(accountId);
    expect(moved).toMatchObject({
      date: 20261107,
      card_bill: `${accountId}:2026-12`,
      budget_date: 20261212,
    });
  });

  it('reports the limit used, projected installments included', async () => {
    const accountId = await accountsApp.handlers['account-create']({
      name: 'Cartão',
      kind: 'credit_card',
      card: { closingDay: 5, dueDay: 12, creditLimit: 224000 },
    });
    await addTransaction({
      account: accountId,
      date: '2026-10-10',
      amount: -10000,
      notes: 'LOJA X',
      imported_id: 'pluggy-1',
      raw_synced_data: pluggyRaw({
        description: 'LOJA X',
        'creditCardMetadata.installmentNumber': 1,
        'creditCardMetadata.totalInstallments': 2,
      }),
    });
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    const result = await getCardBills(accountId, { today: TODAY });
    expect(result.limit).toEqual({
      total: 224000,
      used: 20000,
      available: 204000,
    });
  });

  it('stops and resumes the projections of a purchase', async () => {
    const accountId = await createCard();
    await addTransaction({
      id: 'first',
      account: accountId,
      date: '2026-10-10',
      amount: -10000,
      notes: 'LOJA X',
      imported_id: 'pluggy-1',
      raw_synced_data: pluggyRaw({
        description: 'LOJA X',
        'creditCardMetadata.installmentNumber': 1,
        'creditCardMetadata.totalInstallments': 3,
      }),
    });
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));
    const projected = async () =>
      (await cardRows(accountId)).filter(
        row => row.projected === 1 && row.tombstone === 0,
      ).length;
    expect(await projected()).toBe(2);

    const [{ card_purchase: purchaseId }] = await cardRows(accountId);
    await app.handlers['credit-card-purchase-status']({
      id: purchaseId!,
      status: 'cancelled',
    });
    expect(await projected()).toBe(0);

    await app.handlers['credit-card-purchase-status']({
      id: purchaseId!,
      status: 'active',
    });
    expect(await projected()).toBe(2);
  });

  it('keeps a split installment on its bill and its parts budgeted with it', async () => {
    const accountId = await createCard();
    await addTransaction({
      id: 'first',
      account: accountId,
      date: '2026-10-10',
      amount: -10000,
      notes: 'LOJA X',
      imported_id: 'pluggy-1',
      raw_synced_data: pluggyRaw({
        description: 'LOJA X',
        'creditCardMetadata.installmentNumber': 1,
        'creditCardMetadata.totalInstallments': 3,
      }),
    });
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));

    await runMutator(async () => {
      await db.updateTransaction({ id: 'first', is_parent: true });
      for (const [id, amount] of [
        ['part-a', -6000],
        ['part-b', -4000],
      ] as const) {
        await db.insertTransaction({
          id,
          account: accountId,
          date: '2026-10-10',
          amount,
          parent_id: 'first',
          is_child: true,
          cleared: true,
        });
      }
    });
    await runMutator(() => reconcileCardAccount(accountId, { today: TODAY }));

    const rows = await db.all<{
      id: string;
      card_bill: string | null;
      card_kind: string | null;
      budget_date: number | null;
      projected: number;
    }>(
      `SELECT id, card_bill, card_kind, budget_date, projected FROM transactions
       WHERE acct = ? AND tombstone = 0 ORDER BY id`,
      [accountId],
    );
    expect(rows.filter(row => row.projected === 1)).toHaveLength(2);
    expect(
      rows
        .filter(row => !row.projected)
        .map(row => [row.id, row.card_bill, row.card_kind, row.budget_date]),
    ).toEqual([
      ['first', `${accountId}:2026-11`, 'installment', 20261112],
      ['part-a', `${accountId}:2026-11`, 'installment', 20261112],
      ['part-b', `${accountId}:2026-11`, 'installment', 20261112],
    ]);
    const [bill] = (await getCardBills(accountId, { today: TODAY })).bills;
    expect(bill.charges).toBe(10000);
  });
});
