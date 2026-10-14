import { createBillCalendar } from './bill-calendar';
import { projectedInstallmentId } from './ids';
import type { PlanInput } from './plan';
import { planCardAccount } from './plan';
import { cardEntry } from './test-fixtures';
import type { CardEntry, CardSchedule, Purchase } from './types';

const ACCOUNT = 'card-account';

const closesOnFifth: CardSchedule = {
  closing: { kind: 'fixed_day', day: 5 },
  dueDay: 12,
  closingDayInNextBill: true,
};

// Cartão Inter PF in the 2026-10-14 export: closes on the 4th, due on the 10th.
const inter: CardSchedule = {
  closing: { kind: 'fixed_day', day: 4 },
  dueDay: 10,
  closingDayInNextBill: true,
};

function plan(
  entries: CardEntry[],
  overrides: Partial<PlanInput> & { schedule?: CardSchedule } = {},
) {
  const { schedule = closesOnFifth, ...rest } = overrides;
  return planCardAccount({
    accountId: ACCOUNT,
    calendar: createBillCalendar(schedule),
    billMonthByProviderId: new Map(),
    entries,
    purchases: [],
    deletedProjectedIds: new Set(),
    today: '2026-10-14',
    ...rest,
  });
}

function sixTimes(fields: Partial<Parameters<typeof cardEntry>[0]> = {}) {
  return cardEntry({
    id: 'loja-1',
    importedId: 'pluggy-1',
    date: '2026-10-10',
    amount: -10000,
    description: 'LOJA X',
    provider: { installment: { number: 1, count: 6 } },
    ...fields,
  });
}

describe('planCardAccount', () => {
  it('spreads a 6x purchase over six bills and projects the missing ones', () => {
    const result = plan([sixTimes()]);

    const [first] = result.entries;
    expect(first).toMatchObject({
      bill: '2026-11',
      billSource: 'installment',
      kind: 'installment',
      installmentNumber: 1,
      installmentCount: 6,
      date: '2026-10-10',
      budgetDate: '2026-11-12',
    });

    expect(
      result.projected.map(row => [
        row.installmentNumber,
        row.date,
        row.bill,
        row.budgetDate,
        row.amount,
      ]),
    ).toEqual([
      [2, '2026-11-10', '2026-12', '2026-12-12', -10000],
      [3, '2026-12-10', '2027-01', '2027-01-12', -10000],
      [4, '2027-01-10', '2027-02', '2027-02-12', -10000],
      [5, '2027-02-10', '2027-03', '2027-03-12', -10000],
      [6, '2027-03-10', '2027-04', '2027-04-12', -10000],
    ]);
    expect(result.projected[0].id).toBe(
      projectedInstallmentId(ACCOUNT, first.purchaseId!, 2),
    );
    expect(result.projected.every(row => row.templateId === 'loja-1')).toBe(
      true,
    );
    expect(result.months).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ]);
  });

  it('gives the same ids on every run', () => {
    const a = plan([sixTimes()]);
    const b = plan([sixTimes()]);
    expect(a.entries[0].purchaseId).toBe(b.entries[0].purchaseId);
    expect(a.projected.map(row => row.id)).toEqual(
      b.projected.map(row => row.id),
    );
  });

  it('assigns installments by index, not by shifting the date', () => {
    const result = plan(
      [
        sixTimes({
          id: 'a',
          importedId: 'a',
          date: '2027-01-29',
          provider: { installment: { number: 1, count: 3 } },
        }),
      ],
      {
        schedule: {
          closing: { kind: 'fixed_day', day: 30 },
          dueDay: 7,
          closingDayInNextBill: true,
        },
        today: '2027-01-30',
      },
    );
    expect(result.entries[0].bill).toBe('2027-02');
    expect(result.projected.map(row => [row.bill, row.date])).toEqual([
      ['2027-03', '2027-02-27'],
      ['2027-04', '2027-03-29'],
    ]);
  });

  it('drops the projection once the real installment exists', () => {
    const first = plan([sixTimes()]);
    const purchase = first.purchases[0];
    const projectedSecond = first.projected[0];

    const second = plan(
      [
        sixTimes({
          stored: {
            purchaseId: purchase.id,
            bill: '2026-11',
            billSource: 'installment',
            kind: 'installment',
            installmentNumber: 1,
            installmentCount: 6,
          },
        }),
        cardEntry({
          id: 'loja-2',
          importedId: 'pluggy-2',
          date: '2026-12-05',
          amount: -10000,
          description: 'LOJA X',
          provider: { installment: { number: 2, count: 6 } },
        }),
        cardEntry({
          id: projectedSecond.id,
          date: projectedSecond.date,
          amount: projectedSecond.amount,
          projected: true,
          description: 'LOJA X',
          stored: {
            purchaseId: purchase.id,
            bill: '2026-12',
            installmentNumber: 2,
            installmentCount: 6,
          },
        }),
      ],
      { purchases: first.purchases },
    );

    const real = second.entries.find(entry => entry.id === 'loja-2')!;
    expect(real.purchaseId).toBe(purchase.id);
    expect(real.bill).toBe('2026-12');
    expect(real.date).toBe('2026-11-10');
    expect(second.removeProjected).toEqual([projectedSecond.id]);
    expect(second.projected.map(row => row.installmentNumber)).toEqual([
      3, 4, 5, 6,
    ]);
  });

  it('matches a renamed installment to its projection by bill and amount', () => {
    const first = plan([sixTimes()]);
    const purchase = first.purchases[0];
    const projectedSecond = first.projected[0];

    const second = plan(
      [
        sixTimes({
          stored: { purchaseId: purchase.id, bill: '2026-11' },
        }),
        cardEntry({
          id: 'renamed',
          importedId: 'pluggy-9',
          date: '2026-11-20',
          amount: -10001,
          description: 'LOJA X COMERCIO LTDA',
          provider: { installment: { number: 2, count: 6 } },
        }),
        cardEntry({
          id: projectedSecond.id,
          date: projectedSecond.date,
          amount: projectedSecond.amount,
          projected: true,
          stored: {
            purchaseId: purchase.id,
            bill: '2026-12',
            installmentNumber: 2,
            installmentCount: 6,
          },
        }),
      ],
      { purchases: first.purchases },
    );
    const renamed = second.entries.find(entry => entry.id === 'renamed')!;
    expect(renamed.purchaseId).toBe(purchase.id);
    expect(second.purchases).toHaveLength(1);
  });

  it('keeps two identical purchases made the same day apart', () => {
    const result = plan([
      sixTimes({ id: 'x', importedId: 'x' }),
      sixTimes({ id: 'y', importedId: 'y' }),
    ]);
    expect(result.purchases).toHaveLength(2);
    expect(result.projected).toHaveLength(10);
    const ids = new Set(result.entries.map(entry => entry.purchaseId));
    expect(ids.size).toBe(2);
  });

  it('tolerates rounding cents between installments', () => {
    const result = plan([
      sixTimes({ amount: -16670 }),
      cardEntry({
        id: 'loja-2',
        importedId: 'pluggy-2',
        date: '2026-12-05',
        amount: -16666,
        description: 'LOJA X PARC 02/06',
      }),
    ]);
    expect(result.purchases).toHaveLength(1);
  });

  it('uses the bank bill and purchase date of Inter installments', () => {
    // PNEUCENTERCENTRO 2/6: bought 2026-07-11, posted 2026-08-12 on the bill
    // due 2026-09-10.
    const result = plan(
      [
        cardEntry({
          id: 'pneu-2',
          importedId: 'a3',
          date: '2026-08-12',
          amount: -19500,
          description: 'PNEUCENTERCENTRO       BARRETOS      BRA',
          provider: {
            installment: { number: 2, count: 6 },
            purchaseDate: '2026-07-11',
            billId: 'bill-sep',
            cardLast4: '2071',
          },
        }),
        cardEntry({
          id: 'pneu-3',
          importedId: 'b4',
          date: '2026-09-13',
          amount: -19500,
          description: 'PNEUCENTERCENTRO       BARRETOS      BRA',
          provider: {
            installment: { number: 3, count: 6 },
            purchaseDate: '2026-07-11',
            billId: 'bill-oct',
            cardLast4: '2071',
          },
        }),
      ],
      {
        schedule: inter,
        billMonthByProviderId: new Map([
          ['bill-sep', '2026-09'],
          ['bill-oct', '2026-10'],
        ]),
      },
    );
    expect(result.purchases).toHaveLength(1);
    expect(result.purchases[0]).toMatchObject({
      anchorMonth: '2026-08',
      purchaseDate: '2026-07-11',
    });
    expect(
      result.entries.map(entry => [entry.bill, entry.billSource, entry.date]),
    ).toEqual([
      ['2026-09', 'provider', '2026-08-11'],
      ['2026-10', 'provider', '2026-09-11'],
    ]);
    expect(result.projected.map(row => [row.bill, row.date])).toEqual([
      ['2026-11', '2026-10-11'],
      ['2026-12', '2026-11-11'],
      ['2027-01', '2026-12-11'],
    ]);
  });

  it('cancels the rest of a refunded installment purchase', () => {
    const result = plan([
      sixTimes({ date: '2026-08-10' }),
      cardEntry({
        id: 'loja-2',
        importedId: 'pluggy-2',
        date: '2026-09-10',
        amount: -10000,
        description: 'LOJA X',
        provider: { installment: { number: 2, count: 6 } },
      }),
      cardEntry({
        id: 'estorno',
        importedId: 'pluggy-3',
        date: '2026-10-01',
        amount: 40000,
        description: 'LOJA X',
      }),
    ]);
    expect(result.purchases[0].status).toBe('cancelled');
    expect(result.projected).toEqual([]);
    expect(result.suggestions).toContainEqual({
      kind: 'cancelled-purchase',
      purchaseId: result.purchases[0].id,
      creditId: 'estorno',
    });
  });

  it('attributes a payment to the bill that closed before it', () => {
    const result = plan([
      cardEntry({
        id: 'pay',
        date: '2026-11-11',
        amount: 125000,
        description: 'Pagamento recebido',
        provider: { operationType: 'PAGAMENTO_FATURA' },
      }),
    ]);
    expect(result.entries[0]).toMatchObject({
      kind: 'payment',
      bill: '2026-11',
      budgetDate: null,
    });
  });

  it('bills a charge by the day the bank posted it', () => {
    const result = plan(
      [
        cardEntry({
          id: 'closing-day',
          date: '2026-10-04',
          amount: -5490,
          description: 'APPLE.COM/BILL',
          provider: { postDate: '2026-10-04' },
        }),
        cardEntry({
          id: 'late-post',
          date: '2026-10-03',
          amount: -2000,
          description: 'PADARIA',
          provider: { postDate: '2026-10-06' },
        }),
      ],
      { schedule: inter },
    );
    expect(result.entries.map(entry => [entry.id, entry.bill])).toEqual([
      ['closing-day', '2026-10'],
      ['late-post', '2026-11'],
    ]);
  });

  it('keeps a bill the user chose', () => {
    const result = plan([
      cardEntry({
        id: 'a',
        date: '2026-10-10',
        amount: -5000,
        description: 'MERCADO',
        stored: { bill: '2026-12', billSource: 'user' },
      }),
    ]);
    expect(result.entries[0]).toMatchObject({
      bill: '2026-12',
      billSource: 'user',
      budgetDate: '2026-12-12',
    });
  });

  it('does not recreate a projected installment the user deleted', () => {
    const first = plan([sixTimes()]);
    const deleted = first.projected[0].id;
    const second = plan([sixTimes()], {
      deletedProjectedIds: new Set([deleted]),
    });
    expect(second.projected.map(row => row.id)).not.toContain(deleted);
    expect(second.projected).toHaveLength(4);
  });

  it('stops projecting an installment whose bill is past due', () => {
    const result = plan([sixTimes({ date: '2026-06-10' })]);
    // The August to October bills are past due on 2026-10-14.
    expect(result.projected.map(row => row.bill)).toEqual([
      '2026-11',
      '2026-12',
    ]);
    expect(
      result.suggestions.filter(
        suggestion => suggestion.kind === 'missing-installment',
      ),
    ).toHaveLength(3);
  });

  it('folds a purchase created twice by two devices', () => {
    const base: Omit<Purchase, 'id'> = {
      stem: 'LOJA X',
      installmentCount: 6,
      cardLast4: null,
      anchorMonth: '2026-11',
      purchaseDate: '2026-10-10',
      totalAmount: null,
      status: 'active',
    };
    const result = plan(
      [
        sixTimes({ stored: { purchaseId: 'p-b' } }),
        cardEntry({
          id: 'loja-2',
          importedId: 'pluggy-2',
          date: '2026-12-05',
          amount: -10000,
          description: 'LOJA X',
          provider: { installment: { number: 2, count: 6 } },
          stored: { purchaseId: 'p-a' },
        }),
      ],
      {
        purchases: [
          { ...base, id: 'p-a' },
          { ...base, id: 'p-b' },
        ],
      },
    );
    expect(result.removePurchases).toEqual(['p-b']);
    expect(new Set(result.entries.map(entry => entry.purchaseId))).toEqual(
      new Set(['p-a']),
    );
    expect(result.projected.map(row => row.installmentNumber)).toEqual([
      3, 4, 5, 6,
    ]);
  });
});
