import type { CardBill } from '@actual-app/core/server/credit-cards/bills';
import * as monthUtils from '@actual-app/core/shared/months';

type TrendBill = Pick<
  CardBill,
  'referenceMonth' | 'status' | 'total' | 'projectedCharges' | 'complete'
>;

export type BillTrendPoint = {
  month: string;
  /** Part of the total already on the card. */
  posted: number;
  projected: number;
  total: number;
  status: CardBill['status'];
};

export type BillComparison = {
  average: number;
  /** How many past bills the average covers. */
  count: number;
  /** `total / average - 1`; null when the average isn't positive. */
  ratio: number | null;
};

export type BillCycle = {
  /** Where today falls between the cycle's first day and the due date, 0 to 1. */
  todayShare: number;
  closingShare: number;
  daysToClose: number;
  daysToDue: number;
};

function isSettled(bill: Pick<CardBill, 'status'>) {
  return bill.status !== 'open' && bill.status !== 'upcoming';
}

/**
 * The bills around the selected one, mostly before it. When fewer bills
 * follow it than `after`, the window reaches further back instead.
 */
export function getBillTrend(
  bills: readonly TrendBill[],
  index: number,
  { before = 5, after = 2 }: { before?: number; after?: number } = {},
): BillTrendPoint[] {
  const size = before + after + 1;
  const end = Math.min(bills.length, index + after + 1);
  const start = Math.max(0, end - size);
  return bills.slice(start, end).map(bill => ({
    month: bill.referenceMonth,
    posted: bill.total - bill.projectedCharges,
    projected: bill.projectedCharges,
    total: bill.total,
    status: bill.status,
  }));
}

/** The selected bill against the average of the closed bills before it. */
export function compareWithPastBills(
  bills: readonly TrendBill[],
  index: number,
  limit = 6,
): BillComparison | null {
  const bill = bills[index];
  const past = bills
    .slice(0, index)
    .filter(other => other.complete && isSettled(other))
    .slice(-limit);
  if (!bill || past.length === 0) {
    return null;
  }
  const average = Math.round(
    past.reduce((sum, other) => sum + other.total, 0) / past.length,
  );
  return {
    average,
    count: past.length,
    ratio: average > 0 ? bill.total / average - 1 : null,
  };
}

export function getBillCycle(
  bill: Pick<CardBill, 'startDate' | 'closingDate' | 'effectiveDueDate'>,
  today: string,
): BillCycle {
  const length = Math.max(
    1,
    monthUtils.differenceInCalendarDays(bill.effectiveDueDate, bill.startDate),
  );
  const share = (date: string) =>
    Math.min(
      1,
      Math.max(0, monthUtils.differenceInCalendarDays(date, bill.startDate)) /
        length,
    );
  return {
    todayShare: share(today),
    closingShare: share(bill.closingDate),
    daysToClose: monthUtils.differenceInCalendarDays(bill.closingDate, today),
    daysToDue: monthUtils.differenceInCalendarDays(
      bill.effectiveDueDate,
      today,
    ),
  };
}
