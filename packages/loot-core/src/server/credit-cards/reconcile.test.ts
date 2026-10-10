import { beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import { setSyncingMode } from '#server/sync';

import { app } from './app';
import { isCreditCardError } from './cards';

async function emptyDatabase(): Promise<void> {
  const globals = globalThis as typeof globalThis & {
    emptyDatabase: (avoidUpdate?: boolean) => () => Promise<void>;
  };
  await globals.emptyDatabase()();
}

beforeEach(async () => {
  setSyncingMode('disabled');
  await emptyDatabase();
});

async function card() {
  const accountId = await db.insertAccount({
    name: 'Inter Card',
    offbudget: 0,
  });
  const created = await app.handlers['credit-cards-create']({
    accountId,
    name: 'Inter',
    closingDay: 10,
    dueDay: 17,
    closingDayPolicy: 'current',
  });
  if (isCreditCardError(created)) {
    throw new Error(created.error);
  }
  return { accountId, cardId: created.id };
}

async function charge(
  accountId: string,
  date: string,
  amount: number,
  raw: Record<string, unknown> | null,
  transferId?: string,
) {
  const id = await db.insertTransaction({
    account: accountId,
    date,
    amount,
    notes: 'STORE',
    ...(transferId ? { transfer_id: transferId } : {}),
  });
  if (raw) {
    await db.update('transactions', {
      id,
      raw_synced_data: JSON.stringify(raw),
    });
  }
  return id;
}

describe('credit card reconciliation', () => {
  it('groups installment transactions once and does not insert new ones', async () => {
    const { accountId, cardId } = await card();
    const metadata = {
      'creditCardMetadata.totalInstallments': 3,
      'creditCardMetadata.purchaseDate': '2017-01-05',
      'creditCardMetadata.totalAmount': 585.9,
    };
    await charge(accountId, '2017-01-05', -19530, {
      ...metadata,
      'creditCardMetadata.installmentNumber': 1,
    });
    await charge(accountId, '2017-02-05', -19530, {
      ...metadata,
      'creditCardMetadata.installmentNumber': 2,
    });
    const before = await db.all('SELECT id FROM transactions');

    const first = await app.handlers['credit-cards-reconcile']({
      cardId,
      today: '2017-01-15',
    });
    const second = await app.handlers['credit-cards-reconcile']({
      cardId,
      today: '2017-01-15',
    });
    expect(first).toMatchObject({
      purchases: 1,
      installmentsLinked: 2,
      paymentsLinked: 0,
    });
    expect(second).toMatchObject({
      purchases: 0,
      installmentsLinked: 0,
      paymentsLinked: 0,
      reviews: 0,
    });

    const purchases = await db.all(
      'SELECT id FROM credit_card_purchases WHERE tombstone = 0',
    );
    expect(purchases).toHaveLength(1);
    const linked = await db.all<{ transaction_id: string | null }>(
      'SELECT transaction_id FROM credit_card_installments WHERE tombstone = 0 AND transaction_id IS NOT NULL',
    );
    expect(linked).toHaveLength(2);
    const after = await db.all('SELECT id FROM transactions');
    expect(after).toHaveLength(before.length);
  });

  it('links an exact transfer and queues an ambiguous one', async () => {
    const { accountId, cardId } = await card();
    const bankAccount = await db.insertAccount({
      name: 'Checking',
      offbudget: 0,
    });
    await charge(accountId, '2017-01-05', -94825, null);
    const bankPayment = await db.insertTransaction({
      account: bankAccount,
      date: '2017-01-16',
      amount: -94825,
      notes: 'card payment',
    });
    await charge(accountId, '2017-01-16', 94825, null, bankPayment);

    const linked = await app.handlers['credit-cards-reconcile']({
      cardId,
      today: '2017-01-15',
    });
    expect(linked).toMatchObject({ paymentsLinked: 1, reviews: 0 });

    const again = await app.handlers['credit-cards-reconcile']({
      cardId,
      today: '2017-01-15',
    });
    expect(again).toMatchObject({ paymentsLinked: 0, reviews: 0 });
    const payments = await db.all(
      'SELECT id, bank_transaction_id FROM credit_card_payments WHERE tombstone = 0',
    );
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ bank_transaction_id: bankPayment });

    const { accountId: otherAccount, cardId: otherCard } = await card();
    await charge(otherAccount, '2017-01-05', -5000, null);
    await charge(otherAccount, '2017-02-05', -5000, null);
    const otherBank = await db.insertTransaction({
      account: bankAccount,
      date: '2017-02-10',
      amount: -5000,
    });
    await charge(otherAccount, '2017-02-10', 5000, null, otherBank);
    const ambiguous = await app.handlers['credit-cards-reconcile']({
      cardId: otherCard,
      today: '2017-02-15',
    });
    expect(ambiguous).toMatchObject({ paymentsLinked: 0, reviews: 1 });
    const repeat = await app.handlers['credit-cards-reconcile']({
      cardId: otherCard,
      today: '2017-02-15',
    });
    expect(repeat).toMatchObject({ paymentsLinked: 0, reviews: 0 });
    const reviews = await db.all(
      'SELECT id FROM credit_card_review_items WHERE card_id = ? AND tombstone = 0',
      [otherCard],
    );
    expect(reviews).toHaveLength(1);
    const unlinked = await db.all(
      'SELECT id FROM credit_card_payments WHERE card_id = ? AND tombstone = 0',
      [otherCard],
    );
    expect(unlinked).toHaveLength(0);
  });
});
