import type { CardBill } from '@actual-app/core/server/credit-cards/bills';

import { compareWithPastBills, getBillCycle, getBillTrend } from './billTrend';

function bill(
  referenceMonth: string,
  total: number,
  overrides: Partial<
    Pick<CardBill, 'status' | 'projectedCharges' | 'complete'>
  > = {},
) {
  return {
    referenceMonth,
    total,
    status: 'paid' as CardBill['status'],
    projectedCharges: 0,
    complete: true,
    ...overrides,
  };
}

const bills = [
  bill('2026-05', 1000, { complete: false }),
  bill('2026-06', 2000),
  bill('2026-07', 3000),
  bill('2026-08', 4000),
  bill('2026-09', 5000, { status: 'closed' }),
  bill('2026-10', 6000, { status: 'open', projectedCharges: 1500 }),
  bill('2026-11', 2000, { status: 'upcoming', projectedCharges: 2000 }),
  bill('2026-12', 1000, { status: 'upcoming', projectedCharges: 1000 }),
  bill('2027-01', 500, { status: 'upcoming', projectedCharges: 500 }),
];

describe('getBillTrend', () => {
  it('shows the bills before the selected one and a few after it', () => {
    const trend = getBillTrend(bills, 5, { before: 3, after: 2 });
    expect(trend.map(point => point.month)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });

  it('splits each total into what is on the card and projected installments', () => {
    const [point] = getBillTrend(bills, 5, { before: 0, after: 0 });
    expect(point).toEqual({
      month: '2026-10',
      posted: 4500,
      projected: 1500,
      total: 6000,
      status: 'open',
    });
  });

  it('reaches further back when fewer bills follow', () => {
    const trend = getBillTrend(bills, 8, { before: 3, after: 2 });
    expect(trend.map(point => point.month)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('stops at the first bill', () => {
    const trend = getBillTrend(bills, 0, { before: 3, after: 1 });
    expect(trend.map(point => point.month)).toEqual(['2026-05', '2026-06']);
  });
});

describe('compareWithPastBills', () => {
  it('averages the complete, settled bills before the selected one', () => {
    expect(compareWithPastBills(bills, 5)).toEqual({
      average: 3500,
      count: 4,
      ratio: 6000 / 3500 - 1,
    });
  });

  it('keeps only the most recent bills', () => {
    expect(compareWithPastBills(bills, 5, 2)).toMatchObject({
      average: 4500,
      count: 2,
    });
  });

  it('has nothing to compare the first bills with', () => {
    expect(compareWithPastBills(bills, 0)).toBeNull();
    expect(compareWithPastBills(bills, 1)).toBeNull();
  });

  it('leaves the ratio out when the average is not positive', () => {
    const credits = [bill('2026-08', -500), bill('2026-09', 1000)];
    expect(compareWithPastBills(credits, 1)).toEqual({
      average: -500,
      count: 1,
      ratio: null,
    });
  });
});

describe('getBillCycle', () => {
  const period = {
    startDate: '2026-10-03',
    closingDate: '2026-11-02',
    effectiveDueDate: '2026-11-10',
  };

  it('places today and the closing date on the way to the due date', () => {
    const cycle = getBillCycle(period, '2026-10-15');
    expect(cycle.todayShare).toBeCloseTo(12 / 38);
    expect(cycle.closingShare).toBeCloseTo(30 / 38);
    expect(cycle.daysToClose).toBe(18);
    expect(cycle.daysToDue).toBe(26);
  });

  it('keeps today on the track before and after the cycle', () => {
    expect(getBillCycle(period, '2026-09-20').todayShare).toBe(0);
    const late = getBillCycle(period, '2026-11-20');
    expect(late.todayShare).toBe(1);
    expect(late.daysToDue).toBe(-10);
  });
});
