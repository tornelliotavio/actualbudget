import type { BillOccurrence } from '#components/reports/reports/bills/billOccurrences';

import { getHomeBillTotals, isPayable, mergeHomeBills } from './homeBills';
import type { HomeCard, HomeCardBill } from './homeBills';

function occurrence(fields: Partial<BillOccurrence>): BillOccurrence {
  return {
    id: 'rent-2026-10-10',
    scheduleId: 'rent',
    name: 'Rent',
    date: '2026-10-10',
    amount: -140000,
    isIncome: false,
    isEstimate: false,
    status: 'upcoming',
    ...fields,
  };
}

function cardBill(fields: Partial<HomeCardBill>): HomeCardBill {
  return {
    referenceMonth: '2026-10',
    closingDate: '2026-10-05',
    effectiveDueDate: '2026-10-13',
    status: 'closed',
    total: 140753,
    paid: 0,
    remaining: 140753,
    minimumPayment: 21113,
    ...fields,
  };
}

const card = (bills: HomeCardBill[]): HomeCard => ({
  accountId: 'card',
  name: 'Cartão MercadoPago',
  bills,
});

const base = {
  month: '2026-10',
  cardAccountsBySchedule: new Map<string, string>(),
  scheduleAccounts: new Map<string, string | null>([['rent', 'checking']]),
  cards: [],
};

describe('mergeHomeBills', () => {
  it('maps schedule occurrences, a missed one as overdue', () => {
    const bills = mergeHomeBills({
      ...base,
      occurrences: [
        occurrence({ status: 'missed' }),
        occurrence({
          id: 'power',
          scheduleId: 'power',
          name: 'Power',
          status: 'paid',
          amount: -5512,
        }),
      ],
    });

    expect(
      bills.map(bill => [
        bill.name,
        bill.status,
        bill.amountDue,
        bill.paidAmount,
      ]),
    ).toEqual([
      ['Rent', 'overdue', 140000, 0],
      ['Power', 'paid', 0, 5512],
    ]);
    expect(bills[0].payFromAccountId).toBe('checking');
  });

  it('takes a card schedule status and amount from the card bill', () => {
    const bills = mergeHomeBills({
      ...base,
      cardAccountsBySchedule: new Map([['card-bill', 'card']]),
      cards: [
        card([
          cardBill({
            status: 'partially_paid',
            paid: 40000,
            remaining: 100753,
          }),
        ]),
      ],
      occurrences: [
        occurrence({
          id: 'card-bill-2026-10-13',
          scheduleId: 'card-bill',
          name: 'Fatura',
          status: 'paid',
          amount: -40000,
        }),
      ],
    });

    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      status: 'partially_paid',
      amount: 140753,
      amountDue: 100753,
      paidAmount: 40000,
      cardAccountId: 'card',
      scheduleId: 'card-bill',
      dueDate: '2026-10-13',
    });
  });

  it('lists the bill of a card no schedule pays', () => {
    const bills = mergeHomeBills({
      ...base,
      occurrences: [],
      cards: [
        card([
          cardBill({ referenceMonth: '2026-09', status: 'paid' }),
          cardBill({ status: 'open', total: 11385, remaining: 11385 }),
        ]),
      ],
    });

    expect(bills.map(bill => [bill.name, bill.status, bill.amountDue])).toEqual(
      [['Cartão MercadoPago', 'open', 11385]],
    );
    expect(isPayable(bills[0])).toBe(true);
  });

  it('flags a paid bill whose payment the bank has not sent', () => {
    const [bill] = mergeHomeBills({
      ...base,
      occurrences: [occurrence({ status: 'paid' })],
      awaitingBankScheduleIds: new Set(['rent']),
    });

    expect(bill.awaitingBank).toBe(true);
    expect(isPayable(bill)).toBe(false);
  });

  it('sorts the most urgent first', () => {
    const bills = mergeHomeBills({
      ...base,
      occurrences: [
        occurrence({ id: 'a', name: 'Paid', status: 'paid' }),
        occurrence({
          id: 'b',
          name: 'Later',
          status: 'scheduled',
          date: '2026-10-28',
        }),
        occurrence({ id: 'c', name: 'Due', status: 'due', date: '2026-10-16' }),
      ],
    });

    expect(bills.map(bill => bill.name)).toEqual(['Due', 'Later', 'Paid']);
  });
});

describe('getHomeBillTotals', () => {
  it('adds what is still to pay, what was paid and expected income', () => {
    const bills = mergeHomeBills({
      ...base,
      cardAccountsBySchedule: new Map([['card-bill', 'card']]),
      cards: [
        card([
          cardBill({
            status: 'partially_paid',
            paid: 40000,
            remaining: 100753,
          }),
        ]),
      ],
      occurrences: [
        occurrence({ status: 'missed' }),
        occurrence({ id: 'card', scheduleId: 'card-bill', name: 'Fatura' }),
        occurrence({
          id: 'salary',
          scheduleId: 'salary',
          name: 'Salary',
          amount: 700000,
          isIncome: true,
          status: 'due',
        }),
      ],
    });

    expect(getHomeBillTotals(bills)).toEqual({
      toPay: 140000 + 100753,
      paid: 40000,
      overdueCount: 1,
      incomePending: 700000,
      incomeReceived: 0,
    });
  });
});
