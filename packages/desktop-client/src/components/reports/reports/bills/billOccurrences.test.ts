import type { RecurConfig } from '@actual-app/core/types/models';
import { describe, expect, it } from 'vitest';

import {
  getBillTotals,
  getCardAccountsBySchedule,
  getMonthBillOccurrences,
  getOccurrenceDates,
  pickCardBill,
} from './billOccurrences';
import type {
  BillSchedule,
  BillTransaction,
  CardBill,
} from './billOccurrences';

const CHECKING = 'checking';
const CARD = 'card';

function makeSchedule({
  id = 'rent',
  name = 'Rent',
  start = '2016-01-10',
  nextDate = '2016-12-10',
  amount = -100000,
  amountOp = 'isapprox',
  account = CHECKING,
  completed = false,
}: {
  id?: string;
  name?: string;
  start?: string;
  nextDate?: string;
  amount?: BillSchedule['_amount'];
  amountOp?: string;
  account?: string;
  completed?: boolean;
} = {}): BillSchedule {
  const recur: RecurConfig = {
    start,
    frequency: 'monthly',
    interval: 1,
    patterns: [],
    skipWeekend: false,
    weekendSolveMode: 'after',
    endMode: 'never',
  };

  return {
    id,
    name,
    next_date: nextDate,
    completed,
    custom_upcoming_length: null,
    _account: account,
    _payee: `${id}-payee`,
    _amount: amount,
    _amountOp: amountOp,
    _date: recur,
    _conditions: [{ op: 'isapprox', field: 'date', value: recur }],
  };
}

function makeTransaction(
  schedule: string,
  date: string,
  amount: number,
  account = CHECKING,
): BillTransaction {
  return { schedule, date, amount, account };
}

describe('getOccurrenceDates', () => {
  it('lists every occurrence inside the range', () => {
    expect(
      getOccurrenceDates(makeSchedule(), {
        start: '2016-11-01',
        end: '2017-01-31',
      }),
    ).toEqual(['2016-11-10', '2016-12-10', '2017-01-10']);
  });

  it('returns nothing when the schedule has no date condition', () => {
    expect(
      getOccurrenceDates(
        { _conditions: [] },
        { start: '2016-11-01', end: '2017-01-31' },
      ),
    ).toEqual([]);
  });
});

describe('getMonthBillOccurrences', () => {
  it('marks an occurrence as paid by a payment made a few days early', () => {
    const [occurrence] = getMonthBillOccurrences({
      schedules: [makeSchedule()],
      transactions: [makeTransaction('rent', '2016-12-08', -99000)],
      month: '2016-12',
      upcomingLength: '7',
    });

    expect(occurrence).toMatchObject({
      date: '2016-12-10',
      status: 'paid',
      amount: -99000,
      isIncome: false,
      isEstimate: false,
    });
  });

  it('assigns a payment made in the previous month to the nearest occurrence', () => {
    const schedule = makeSchedule({
      start: '2016-01-05',
      nextDate: '2017-01-05',
    });

    const [occurrence] = getMonthBillOccurrences({
      schedules: [schedule],
      transactions: [makeTransaction('rent', '2016-11-30', -100000)],
      month: '2016-12',
      upcomingLength: '7',
    });

    expect(occurrence).toMatchObject({ date: '2016-12-05', status: 'paid' });
  });

  it('flags an unpaid past occurrence as missed', () => {
    const [occurrence] = getMonthBillOccurrences({
      schedules: [makeSchedule()],
      transactions: [],
      month: '2016-12',
      upcomingLength: '7',
    });

    expect(occurrence).toMatchObject({
      status: 'missed',
      amount: -100000,
    });
  });

  it('leaves out occurrences skipped without a payment', () => {
    expect(
      getMonthBillOccurrences({
        schedules: [makeSchedule({ nextDate: '2017-01-10' })],
        transactions: [],
        month: '2016-12',
        upcomingLength: '7',
      }),
    ).toEqual([]);
  });

  it('leaves out unpaid occurrences of completed schedules', () => {
    expect(
      getMonthBillOccurrences({
        schedules: [makeSchedule({ completed: true })],
        transactions: [],
        month: '2016-12',
        upcomingLength: '7',
      }),
    ).toEqual([]);
  });

  it('ignores the counterpart leg of a linked transfer', () => {
    const [occurrence] = getMonthBillOccurrences({
      schedules: [makeSchedule()],
      transactions: [makeTransaction('rent', '2016-12-09', 100000, CARD)],
      month: '2016-12',
      upcomingLength: '7',
    });

    expect(occurrence.status).toBe('missed');
  });

  it('estimates a ranged amount from the latest payments', () => {
    const schedule = makeSchedule({
      amount: { num1: -800000, num2: -50000 },
      amountOp: 'isbetween',
    });

    const [occurrence] = getMonthBillOccurrences({
      schedules: [schedule],
      transactions: [
        makeTransaction('rent', '2016-08-10', -900000),
        makeTransaction('rent', '2016-09-10', -300000),
        makeTransaction('rent', '2016-10-10', -200000),
        makeTransaction('rent', '2016-11-10', -100000),
      ],
      month: '2016-12',
      upcomingLength: '7',
    });

    expect(occurrence).toMatchObject({
      status: 'missed',
      amount: -200000,
      isEstimate: true,
    });
  });

  it('derives the status of current month occurrences from the upcoming length', () => {
    const occurrences = getMonthBillOccurrences({
      schedules: [
        makeSchedule({
          id: 'a',
          name: 'A',
          start: '2016-01-01',
          nextDate: '2017-01-01',
        }),
        makeSchedule({
          id: 'b',
          name: 'B',
          start: '2016-01-05',
          nextDate: '2017-01-05',
        }),
        makeSchedule({
          id: 'c',
          name: 'C',
          start: '2016-01-20',
          nextDate: '2017-01-20',
        }),
      ],
      transactions: [],
      month: '2017-01',
      upcomingLength: '7',
    });

    expect(occurrences.map(({ name, status }) => [name, status])).toEqual([
      ['A', 'due'],
      ['B', 'upcoming'],
      ['C', 'scheduled'],
    ]);
  });

  it('sorts open occurrences before paid ones', () => {
    const occurrences = getMonthBillOccurrences({
      schedules: [
        makeSchedule({ id: 'paid', name: 'Paid', start: '2016-01-02' }),
        makeSchedule({ id: 'open', name: 'Open', start: '2016-01-20' }),
      ],
      transactions: [makeTransaction('paid', '2016-12-02', -100000)],
      month: '2016-12',
      upcomingLength: '7',
    });

    expect(occurrences.map(({ name }) => name)).toEqual(['Open', 'Paid']);
  });
});

describe('getCardAccountsBySchedule', () => {
  it('finds schedules that pay a card account by transfer', () => {
    const result = getCardAccountsBySchedule(
      [
        makeSchedule({ id: 'itau' }),
        makeSchedule({ id: 'manual' }),
        makeSchedule({ id: 'rent' }),
      ],
      [
        { id: 'itau-payee', transfer_acct: CARD },
        { id: 'manual-payee', transfer_acct: 'savings' },
        { id: 'rent-payee' },
      ],
      [
        { id: CARD, closed: 0, kind: 'credit_card' },
        { id: 'savings', closed: 0, kind: 'standard' },
      ],
    );

    expect([...result]).toEqual([['itau', CARD]]);
  });
});

describe('pickCardBill', () => {
  const bills: CardBill[] = [
    { dueDate: '2016-11-13', totalAmount: 210000, paidAmount: 210000 },
    { dueDate: '2016-12-13', totalAmount: 249448, paidAmount: 0 },
  ];

  it('picks the bill due in the month', () => {
    expect(pickCardBill(bills, '2016-12')?.totalAmount).toBe(249448);
  });

  it('falls back to the next unpaid bill', () => {
    expect(pickCardBill(bills.slice(1), '2016-11')?.dueDate).toBe('2016-12-13');
    expect(pickCardBill(bills.slice(0, 1), '2016-12')).toBeUndefined();
  });
});

describe('getMonthBillOccurrences with card bills', () => {
  const schedule = makeSchedule({
    id: 'itau',
    name: 'Itaú card',
    start: '2016-01-12',
    nextDate: '2016-12-12',
    amount: { num1: -800000, num2: -50000 },
    amountOp: 'isbetween',
  });
  const transactions = [
    makeTransaction('itau', '2016-10-12', -300000),
    makeTransaction('itau', '2016-11-12', -100000),
  ];

  it('expects the bill total instead of an estimate and shows its due date', () => {
    const [occurrence] = getMonthBillOccurrences({
      schedules: [schedule],
      transactions,
      month: '2016-12',
      upcomingLength: '7',
      cardBillsBySchedule: new Map([
        [
          'itau',
          [{ dueDate: '2016-12-13', totalAmount: 249448, paidAmount: 0 }],
        ],
      ]),
    });

    expect(occurrence).toMatchObject({
      date: '2016-12-12',
      billDueDate: '2016-12-13',
      amount: -249448,
      isEstimate: false,
    });
  });

  it('keeps the estimate when no bill is known', () => {
    const [occurrence] = getMonthBillOccurrences({
      schedules: [schedule],
      transactions,
      month: '2016-12',
      upcomingLength: '7',
      cardBillsBySchedule: new Map([['itau', []]]),
    });

    expect(occurrence).toMatchObject({ amount: -200000, isEstimate: true });
    expect(occurrence.billDueDate).toBeUndefined();
  });
});

describe('getBillTotals', () => {
  it('splits paid and pending amounts by direction', () => {
    const occurrences = getMonthBillOccurrences({
      schedules: [
        makeSchedule({ id: 'rent', start: '2016-01-03' }),
        makeSchedule({
          id: 'power',
          name: 'Power',
          start: '2016-01-20',
          nextDate: '2016-12-20',
        }),
        makeSchedule({
          id: 'salary',
          name: 'Salary',
          start: '2016-01-06',
          nextDate: '2016-12-06',
          amount: 500000,
        }),
      ],
      transactions: [makeTransaction('rent', '2016-12-03', -100000)],
      month: '2016-12',
      upcomingLength: '7',
    });

    expect(getBillTotals(occurrences)).toEqual({
      expensesPending: 100000,
      expensesPaid: 100000,
      incomePending: 500000,
      incomePaid: 0,
      missedCount: 2,
    });
  });
});
