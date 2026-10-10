import { beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import { setSyncingMode } from '#server/sync';

import { app } from './app';
import { isCreditCardError } from './cards';
import { billId } from './engine';

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

const today = '2017-01-15';

describe('credit card ledger', () => {
  it('projects the bill from real transactions and does not insert installments', async () => {
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

    const before = await db.all('SELECT id FROM transactions');
    await db.insertTransaction({
      account: accountId,
      date: '2017-01-05',
      amount: -94825,
      notes: 'market',
    });
    const purchase = await app.handlers['credit-cards-create-purchase']({
      cardId: created.id,
      purchaseDate: '2017-02-05',
      merchant: 'Store',
      totalAmount: 58590,
      installmentCount: 3,
    });
    if ('error' in purchase) {
      throw new Error(purchase.error);
    }

    const afterPurchase = await db.all('SELECT id FROM transactions');
    expect(afterPurchase).toHaveLength(before.length + 1);

    const summary = await app.handlers['credit-cards-summary']({
      cardId: created.id,
      today,
    });
    if ('error' in summary) {
      throw new Error(summary.error);
    }
    expect(summary.currentBillAmount).toBe(94825);
    expect(summary.futureCommitments).toBe(58590);
    expect(summary.totalCommitment).toBe(153415);
    expect(summary.accountBalance).toBe(-94825);
    expect(summary.statement?.referenceMonth).toBe('2017-01');
    expect(summary.statement?.status).toBe('closed');

    const january = billId(created.id, '2017-01');
    const confirmed = await app.handlers['credit-cards-confirm-bill']({
      cardId: created.id,
      referenceMonth: '2017-01',
      confirmedTotal: 100000,
    });
    if ('error' in confirmed) {
      throw new Error(confirmed.error);
    }

    const paymentId = await db.insertTransaction({
      account: accountId,
      date: '2017-01-16',
      amount: 40000,
      notes: 'payment',
    });
    const allocated = await app.handlers['credit-cards-allocate-payment']({
      cardId: created.id,
      billId: january,
      transactionId: paymentId,
      amount: 40000,
    });
    if ('error' in allocated) {
      throw new Error(allocated.error);
    }

    const detail = await app.handlers['credit-cards-bill']({
      cardId: created.id,
      billId: january,
      today,
    });
    if ('error' in detail) {
      throw new Error(detail.error);
    }
    expect(detail.bill.computedTotal).toBe(94825);
    expect(detail.bill.amountOwed).toBe(100000);
    expect(detail.bill.divergence).toBe(5175);
    expect(detail.bill.remaining).toBe(60000);
    expect(detail.bill.status).toBe('partially_paid');
    expect(detail.lines.some(line => line.projected)).toBe(false);

    const paid = await app.handlers['credit-cards-summary']({
      cardId: created.id,
      today,
    });
    if ('error' in paid) {
      throw new Error(paid.error);
    }
    expect(paid.accountBalance).toBe(-54825);
    expect(paid.futureCommitments).toBe(58590);

    const still = await db.all('SELECT id FROM transactions');
    expect(still).toHaveLength(before.length + 2);

    const extra = await db.insertTransaction({
      account: accountId,
      date: '2017-01-06',
      amount: -19500,
      notes: 'STORE PARC 02/06',
    });
    const assigned = await app.handlers['credit-cards-assign-transactions']({
      cardId: created.id,
      billId: january,
      transactionIds: [extra],
    });
    if ('error' in assigned) {
      throw new Error(assigned.error);
    }
    expect(assigned.assigned).toEqual([
      {
        id: extra,
        kind: 'installment',
        installmentNumber: 2,
        totalInstallments: 6,
      },
    ]);
    const moved = await app.handlers['credit-cards-bill']({
      cardId: created.id,
      billId: january,
      today,
    });
    if ('error' in moved) {
      throw new Error(moved.error);
    }
    expect(moved.bill.computedTotal).toBe(94825 + 19500);
  });

  it('keeps the module readable when a newer schema is stored', async () => {
    const accountId = await db.insertAccount({
      name: 'Renner',
      offbudget: 0,
    });
    const created = await app.handlers['credit-cards-create']({
      accountId,
      name: 'Renner',
      closingDay: 5,
      dueDay: 12,
    });
    if (isCreditCardError(created)) {
      throw new Error(created.error);
    }
    await db.update('preferences', {
      id: 'credit-cards-schema-version',
      value: '99',
    });

    const blocked = await app.handlers['credit-cards-update']({
      id: created.id,
      name: 'Changed',
    });
    expect(blocked).toEqual({ error: 'upgrade-required' });

    const listed = await app.handlers['credit-cards-list']();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe('Renner');

    const access = await app.handlers['credit-cards-meta']();
    expect(access.readOnly).toBe(true);
    expect(access.schemaVersion).toBe(99);
  });
});
