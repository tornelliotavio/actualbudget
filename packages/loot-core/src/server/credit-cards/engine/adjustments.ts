import type { BillCalendar } from './bill-calendar';
import { billAdjustmentId } from './ids';
import type { BillSummary } from './summary';
import type { Cents, DateString, MonthString } from './types';

/** Rounding the bank may apply when it itemizes finance charges. */
const TOLERANCE: Cents = 1;

export type AdjustmentRow = {
  id: string;
  bill: MonthString;
  amount: Cents;
};

export type AdjustmentPlan = {
  upsert: Array<{
    id: string;
    bill: MonthString;
    amount: Cents;
    date: DateString;
    budgetDate: DateString;
  }>;
  remove: string[];
};

export type AdjustmentInput = {
  accountId: string;
  calendar: BillCalendar;
  /** Summaries computed without the adjustment rows. */
  bills: BillSummary[];
  financeChargesByMonth: ReadonlyMap<MonthString, Cents>;
  existing: AdjustmentRow[];
  /** Adjustments the user deleted; they are not created again. */
  deletedIds: ReadonlySet<string>;
  /** Bills closing before this day are left alone. */
  from: DateString | null;
};

/**
 * Interest, IOF and fees the bank lists on a bill but never sends as
 * transactions would leave the bill short of what the bank asks for. When a
 * closed bill's gap to the bank total is exactly those charges, one charge
 * dated on closing carries them, so the balance and the bill agree with the
 * bank. Once the charges arrive as transactions the gap closes and the
 * adjustment goes away.
 */
export function planBillAdjustments(input: AdjustmentInput): AdjustmentPlan {
  const desired = new Map<string, AdjustmentPlan['upsert'][number]>();
  for (const bill of input.bills) {
    const charges = input.financeChargesByMonth.get(bill.referenceMonth) ?? 0;
    if (
      bill.providerTotal == null ||
      charges <= 0 ||
      (input.from != null && bill.closingDate < input.from)
    ) {
      continue;
    }
    const gap = bill.providerTotal - bill.computedTotal;
    if (gap <= 0 || Math.abs(gap - charges) > TOLERANCE) {
      continue;
    }
    const id = billAdjustmentId(input.accountId, bill.referenceMonth);
    if (input.deletedIds.has(id)) {
      continue;
    }
    desired.set(id, {
      id,
      bill: bill.referenceMonth,
      amount: -gap,
      date: bill.closingDate,
      budgetDate: input.calendar.period(bill.referenceMonth).budgetDate,
    });
  }

  const current = new Map(input.existing.map(row => [row.id, row]));
  return {
    upsert: [...desired.values()].filter(row => {
      const stored = current.get(row.id);
      return (
        !stored || stored.amount !== row.amount || stored.bill !== row.bill
      );
    }),
    remove: input.existing.map(row => row.id).filter(id => !desired.has(id)),
  };
}
