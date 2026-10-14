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
});
