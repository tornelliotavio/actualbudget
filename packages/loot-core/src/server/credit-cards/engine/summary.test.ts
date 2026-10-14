import { createBillCalendar } from './bill-calendar';
import type { SummaryEntry } from './summary';
import { summarizeBills } from './summary';

const calendar = createBillCalendar({
  closing: { kind: 'fixed_day', day: 5 },
  dueDay: 12,
  closingDayInNextBill: true,
});

function charge(date: string, amount: number, bill: string): SummaryEntry {
  return { date, amount: -amount, kind: 'purchase', bill, projected: false };
}

function payment(date: string, amount: number): SummaryEntry {
  return { date, amount, kind: 'payment', bill: '', projected: false };
}

describe('summarizeBills', () => {
  const entries = [
    charge('2026-10-20', 125000, '2026-11'),
    payment('2026-11-11', 50000),
    charge('2026-11-20', 90000, '2026-12'),
    { ...charge('2026-12-04', 4500, '2026-12'), kind: 'fee' as const },
    { ...charge('2026-12-04', 310, '2026-12'), kind: 'fee' as const },
  ];

  it('carries an unpaid balance into the next bill', () => {
    const [november, december] = summarizeBills(
      calendar,
      [...entries, payment('2026-12-14', 169810)],
      [],
      ['2026-11', '2026-12'],
      '2026-12-20',
    );
    expect(november).toMatchObject({
      total: 125000,
      paid: 50000,
      remaining: 75000,
      status: 'partially_paid',
      carriedOver: true,
    });
    expect(december).toMatchObject({
      charges: 94810,
      previousBalance: 75000,
      total: 169810,
      status: 'paid',
    });
  });

  it('marks an unpaid bill overdue after the due date', () => {
    const [november] = summarizeBills(
      calendar,
      [charge('2026-10-20', 125000, '2026-11')],
      [],
      ['2026-11'],
      '2026-11-13',
    );
    expect(november.status).toBe('overdue');
    expect(november.remaining).toBe(125000);
  });

  it('reports open, closed and partially paid bills', () => {
    const open = summarizeBills(
      calendar,
      [charge('2026-10-20', 125000, '2026-11')],
      [],
      ['2026-11'],
      '2026-11-01',
    );
    expect(open[0].status).toBe('open');

    const closed = summarizeBills(
      calendar,
      [charge('2026-10-20', 125000, '2026-11')],
      [],
      ['2026-11'],
      '2026-11-06',
    );
    expect(closed[0].status).toBe('closed');

    const partial = summarizeBills(
      calendar,
      [charge('2026-10-20', 125000, '2026-11'), payment('2026-11-08', 1000)],
      [],
      ['2026-11'],
      '2026-11-09',
    );
    expect(partial[0].status).toBe('partially_paid');
  });

  it('prefers the bank total and reports the divergence', () => {
    const [november] = summarizeBills(
      calendar,
      [charge('2026-10-20', 125000, '2026-11')],
      [
        {
          referenceMonth: '2026-11',
          providerTotal: 126000,
          userTotal: null,
          minimumPayment: 18900,
        },
      ],
      ['2026-11'],
      '2026-11-06',
    );
    expect(november).toMatchObject({
      total: 126000,
      computedTotal: 125000,
      divergence: 1000,
      minimumPayment: 18900,
    });
  });

  it('applies an early payment to the open bill', () => {
    const [, december] = summarizeBills(
      calendar,
      [
        charge('2026-10-20', 1000, '2026-11'),
        payment('2026-11-10', 1000),
        charge('2026-11-20', 30000, '2026-12'),
        payment('2026-11-21', 30000),
      ],
      [],
      ['2026-11', '2026-12'],
      '2026-11-25',
    );
    expect(december.previousBalance).toBe(-30000);
    expect(december.total).toBe(0);
  });

  it('assumes an open bill gets paid before its balance carries', () => {
    const [, december] = summarizeBills(
      calendar,
      [
        charge('2026-10-20', 125000, '2026-11'),
        charge('2026-11-20', 90000, '2026-12'),
      ],
      [],
      ['2026-11', '2026-12'],
      '2026-11-08',
    );
    expect(december.status).toBe('open');
    expect(december.previousBalance).toBe(0);
    expect(december.total).toBe(90000);
  });

  it('settles a bill whose shortfall a later refund covers', () => {
    const [november, december] = summarizeBills(
      calendar,
      [
        charge('2026-10-20', 91282, '2026-11'),
        payment('2026-11-11', 90824),
        { ...charge('2026-11-08', -458, '2026-12'), kind: 'credit' as const },
      ],
      [],
      ['2026-11', '2026-12'],
      '2026-12-20',
    );
    expect(november).toMatchObject({
      remaining: 0,
      status: 'paid',
      carriedOver: false,
    });
    expect(december.total).toBe(0);
  });

  it('carries no debt from a cycle the history starts in the middle of', () => {
    const [november, december] = summarizeBills(
      calendar,
      [
        charge('2026-10-20', 125000, '2026-11'),
        payment('2026-11-11', 50000),
        charge('2026-11-20', 90000, '2026-12'),
      ],
      [],
      ['2026-11', '2026-12'],
      '2026-12-07',
      '2026-10-20',
    );
    expect(november).toMatchObject({
      complete: false,
      status: 'paid',
      remaining: 0,
    });
    expect(december).toMatchObject({
      complete: true,
      previousBalance: 0,
      total: 90000,
    });
  });

  it('carries an advance payment from a cycle missing its start', () => {
    const [, december] = summarizeBills(
      calendar,
      [
        charge('2026-10-20', 151454, '2026-11'),
        payment('2026-11-11', 151454),
        payment('2026-12-03', 10000),
        charge('2026-11-20', 182118, '2026-12'),
      ],
      [],
      ['2026-11', '2026-12'],
      '2026-12-07',
      '2026-10-20',
    );
    expect(december).toMatchObject({ previousBalance: -10000, total: 172118 });
  });

  it('carries from an incomplete cycle the bank reported', () => {
    const [, december] = summarizeBills(
      calendar,
      [
        charge('2026-10-20', 1000, '2026-11'),
        payment('2026-11-11', 100000),
        charge('2026-11-20', 90000, '2026-12'),
      ],
      [
        {
          referenceMonth: '2026-11',
          providerTotal: 125000,
          userTotal: null,
          minimumPayment: null,
        },
      ],
      ['2026-11', '2026-12'],
      '2026-12-07',
      '2026-10-20',
    );
    expect(december.previousBalance).toBe(25000);
  });
});
