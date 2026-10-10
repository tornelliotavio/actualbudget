import { beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import { setSyncingMode } from '#server/sync';

import { app } from './app';
import { isCreditCardError } from './cards';
import { billId } from './engine';
import { applyPluggyCardSnapshot, dayFromBankDate } from './pluggy-sync';

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

const snapshot = {
  bills: [
    {
      id: 'prov-1',
      dueDate: '2017-01-17',
      totalAmount: 948.25,
      minimumPaymentAmount: 100,
      allowsInstallments: true,
      currency: 'BRL',
    },
  ],
  credit: {
    creditLimit: 5000,
    availableCreditLimit: 3100,
    balanceCloseDate: '2017-01-10',
    balanceDueDate: '2017-01-17',
    brand: 'Visa',
    status: 'ACTIVE',
    holderType: 'MAIN',
  },
};

describe('pluggy card sync', () => {
  it('stores a bill and limits once, and files charges by provider bill id', async () => {
    const accountId = await db.insertAccount({
      name: 'Inter Card',
      offbudget: 0,
    });
    const created = await app.handlers['credit-cards-create']({
      accountId,
      name: 'Inter',
      provider: 'pluggyai',
      providerAccountId: 'pluggy-account',
      closingDay: 10,
      dueDay: 17,
      closingDayPolicy: 'current',
    });
    if (isCreditCardError(created)) {
      throw new Error(created.error);
    }

    const before = await db.all('SELECT id FROM transactions');
    const first = await applyPluggyCardSnapshot({
      cardId: created.id,
      ...snapshot,
    });
    const second = await applyPluggyCardSnapshot({
      cardId: created.id,
      ...snapshot,
    });
    expect(first).toEqual({ bills: 1, limitsUpdated: true });
    expect(second).toEqual({ bills: 1, limitsUpdated: true });

    const bills = await db.all(
      'SELECT id, confirmed_total, provider_bill_id FROM credit_card_bills WHERE tombstone = 0',
    );
    expect(bills).toEqual([
      {
        id: billId(created.id, '2017-01'),
        confirmed_total: 94825,
        provider_bill_id: 'prov-1',
      },
    ]);
    const imports = await db.all(
      'SELECT id FROM credit_card_import_records WHERE tombstone = 0',
    );
    expect(imports).toHaveLength(2);

    const card = await app.handlers['credit-cards-get']({ id: created.id });
    if (isCreditCardError(card)) {
      throw new Error(card.error);
    }
    expect(card.creditLimit).toBe(500000);
    expect(card.availableLimit).toBe(310000);
    expect(card.creditLimitSource).toBe('bank');

    const transactionId = await db.insertTransaction({
      account: accountId,
      date: '2017-03-05',
      amount: -10000,
      notes: 'PARC 02/06',
    });
    await db.update('transactions', {
      id: transactionId,
      raw_synced_data: JSON.stringify({
        'creditCardMetadata.billId': 'prov-1',
        'creditCardMetadata.installmentNumber': 2,
        'creditCardMetadata.totalInstallments': 6,
        originalDate: '2017-03-05',
      }),
    });

    const detail = await app.handlers['credit-cards-bill']({
      cardId: created.id,
      billId: billId(created.id, '2017-01'),
      today: '2017-01-15',
    });
    if ('error' in detail) {
      throw new Error(detail.error);
    }
    expect(detail.lines.map(line => line.id)).toContain(transactionId);
    expect(detail.bill.computedTotal).toBe(10000);
    expect(detail.bill.amountOwed).toBe(94825);

    const after = await db.all('SELECT id FROM transactions');
    expect(after).toHaveLength(before.length + 1);
  });

  it('reads the day from a bank date and ignores anything else', () => {
    expect(dayFromBankDate('2017-01-10')).toBe(10);
    expect(dayFromBankDate('2017-01-31T00:00:00.000Z')).toBe(31);
    expect(dayFromBankDate(null)).toBeNull();
    expect(dayFromBankDate('2017-01')).toBeNull();
  });

  it('does not treat a manual account as a bank card', async () => {
    const accountId = await db.insertAccount({
      name: 'Renner',
      offbudget: 0,
    });
    const preview = await app.handlers['credit-cards-preview-account']({
      accountId,
    });
    expect(preview).toEqual({
      linked: false,
      providerAccountId: null,
      closingDay: null,
      dueDay: null,
      creditLimit: null,
      availableLimit: null,
      brand: null,
    });
  });
});
