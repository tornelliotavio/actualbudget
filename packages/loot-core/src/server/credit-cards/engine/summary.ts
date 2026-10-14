import { addMonths } from '#shared/months';

import type { BillCalendar } from './bill-calendar';
import type {
  BillPeriod,
  CardEntryKind,
  Cents,
  DateString,
  MonthString,
} from './types';

export type BillStatus =
  | 'upcoming'
  | 'open'
  | 'closed'
  | 'partially_paid'
  | 'paid'
  | 'overdue';

/** A card transaction with its bill already resolved. */
export type SummaryEntry = {
  date: DateString;
  amount: Cents;
  kind: CardEntryKind;
  bill: MonthString;
  projected: boolean;
};

export type BillFacts = {
  referenceMonth: MonthString;
  providerTotal: Cents | null;
  userTotal: Cents | null;
  minimumPayment: Cents | null;
};

export type BillSummary = BillPeriod & {
  status: BillStatus;
  /** Charges minus credits on this bill, positive when owed. */
  charges: Cents;
  /** Part of `charges` that comes from projected installments. */
  projectedCharges: Cents;
  /** Unpaid balance of the previous bill carried into this one (negative: credit). */
  previousBalance: Cents;
  /** What this bill asks for: the bank's figure when it sent one. */
  total: Cents;
  /** `total` as computed from transactions, for comparing with the bank. */
  computedTotal: Cents;
  providerTotal: Cents | null;
  /** `providerTotal - computedTotal` once the bank confirmed the bill. */
  divergence: Cents | null;
  minimumPayment: Cents | null;
  /** Payments made after this bill closed, up to today or the next closing. */
  paid: Cents;
  remaining: Cents;
  /** The next bill closed before this one was paid in full. */
  carriedOver: boolean;
  /** Transactions cover the whole cycle; history may start mid-cycle. */
  complete: boolean;
};

/**
 * Bill totals follow the issuer's statement: a bill asks for the previous
 * bill's total, minus payments made during its cycle, plus its own charges.
 * Payments made between two closings pay the bill that closed first.
 */
export function summarizeBills(
  calendar: BillCalendar,
  entries: SummaryEntry[],
  facts: BillFacts[],
  months: MonthString[],
  today: DateString,
  /** Date of the first transaction known; earlier cycles are incomplete. */
  historyStart: DateString | null = null,
): BillSummary[] {
  if (months.length === 0) {
    return [];
  }
  const sorted = [...new Set(months)].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const factsByMonth = new Map(facts.map(fact => [fact.referenceMonth, fact]));

  const charges = new Map<MonthString, Cents>();
  const credits = new Map<MonthString, Cents>();
  const projectedCharges = new Map<MonthString, Cents>();
  const paymentsInCycle = new Map<MonthString, Cents>();
  const paymentsSoFar = new Map<MonthString, Cents>();

  for (const entry of entries) {
    if (entry.kind === 'payment') {
      const cycle = calendar.monthForDate(entry.date);
      paymentsInCycle.set(
        cycle,
        (paymentsInCycle.get(cycle) ?? 0) + entry.amount,
      );
      if (entry.date <= today) {
        paymentsSoFar.set(
          cycle,
          (paymentsSoFar.get(cycle) ?? 0) + entry.amount,
        );
      }
      continue;
    }
    const owed = -entry.amount;
    charges.set(entry.bill, (charges.get(entry.bill) ?? 0) + owed);
    if (entry.kind === 'credit' && !entry.projected) {
      credits.set(entry.bill, (credits.get(entry.bill) ?? 0) + entry.amount);
    }
    if (entry.projected) {
      projectedCharges.set(
        entry.bill,
        (projectedCharges.get(entry.bill) ?? 0) + owed,
      );
    }
  }

  const result: BillSummary[] = [];
  let previousTotal: Cents | null = null;
  let previousReliable = true;
  let previousPeriod: BillPeriod | null = null;

  for (let month = first; month <= last; month = addMonths(month, 1)) {
    const period = calendar.period(month);
    const fact = factsByMonth.get(month);
    const ownCharges = charges.get(month) ?? 0;
    const isClosed = today >= period.closingDate;
    const isOpen = !isClosed && today >= period.startDate;

    let previousBalance = 0;
    if (previousTotal != null && previousPeriod != null) {
      const balance = previousTotal - (paymentsInCycle.get(month) ?? 0);
      if (balance > 0 && !previousReliable) {
        previousBalance = 0;
      } else if (isClosed || balance < 0) {
        previousBalance = balance;
      } else if (isOpen && today > previousPeriod.effectiveDueDate) {
        previousBalance = balance;
      }
    }

    const computedTotal = ownCharges + previousBalance;
    const providerTotal = fact?.providerTotal ?? null;
    const total = providerTotal ?? fact?.userTotal ?? computedTotal;

    const paid = isClosed ? (paymentsSoFar.get(addMonths(month, 1)) ?? 0) : 0;
    const nextClosed =
      today >= calendar.period(addMonths(month, 1)).closingDate;
    // A refund that posts after closing lowers what the bank asks for; the
    // next bill already counts it, so this bill is settled with it.
    const lateCredits = isClosed ? (credits.get(addMonths(month, 1)) ?? 0) : 0;
    const shortfall = Math.max(0, total - paid);
    const complete = historyStart == null || period.startDate >= historyStart;
    // A cycle the history starts in the middle of misses charges and
    // payments, so its total is a guess unless the bank or the user gave it.
    const reliable =
      complete || providerTotal != null || fact?.userTotal != null;
    const remaining =
      shortfall <= lateCredits || (!reliable && paid > 0) ? 0 : shortfall;

    let status: BillStatus;
    if (!isClosed) {
      status = isOpen ? 'open' : 'upcoming';
    } else if (total <= 0 || remaining === 0) {
      status = 'paid';
    } else if (nextClosed) {
      status = paid > 0 ? 'partially_paid' : 'overdue';
    } else if (today > period.effectiveDueDate) {
      status = 'overdue';
    } else {
      status = paid > 0 ? 'partially_paid' : 'closed';
    }

    if (sorted.includes(month)) {
      result.push({
        ...period,
        status,
        charges: ownCharges,
        projectedCharges: projectedCharges.get(month) ?? 0,
        previousBalance,
        total,
        computedTotal,
        providerTotal,
        divergence:
          providerTotal == null ? null : providerTotal - computedTotal,
        minimumPayment: fact?.minimumPayment ?? null,
        paid,
        remaining,
        carriedOver: isClosed && nextClosed && remaining > 0,
        complete,
      });
    }

    // A bill still open or in the future is assumed to be paid in full when
    // it comes due; its balance only carries once it actually closed unpaid.
    // A guessed total only carries an overpayment forward, never a debt.
    previousTotal = isClosed ? total : ownCharges;
    previousReliable = reliable;
    previousPeriod = period;
  }

  return result;
}
