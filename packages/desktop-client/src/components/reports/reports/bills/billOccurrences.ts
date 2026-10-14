import * as monthUtils from '@actual-app/core/shared/months';
import {
  extractScheduleConds,
  getNextDate,
  getScheduledAmount,
  getStatus,
} from '@actual-app/core/shared/schedules';
import type { ScheduleStatusType } from '@actual-app/core/shared/schedules';
import type {
  AccountEntity,
  PayeeEntity,
  ScheduleEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

export type BillStatus = Exclude<ScheduleStatusType, 'completed'>;

export type BillSchedule = Pick<
  ScheduleEntity,
  | 'id'
  | 'name'
  | 'next_date'
  | 'completed'
  | 'custom_upcoming_length'
  | '_account'
  | '_payee'
  | '_amount'
  | '_amountOp'
  | '_date'
  | '_conditions'
>;

export type BillTransaction = Pick<
  TransactionEntity,
  'schedule' | 'date' | 'amount' | 'account'
>;

export type BillOccurrence = {
  id: string;
  scheduleId: string;
  name: string;
  date: string;
  /** Due date of the card bill this occurrence pays, when it pays one. */
  billDueDate?: string;
  amount: number;
  isIncome: boolean;
  isEstimate: boolean;
  status: BillStatus;
};

/** A credit card bill (fatura), amounts in cents. */
export type CardBill = {
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
};

export type BillTotals = {
  expensesPending: number;
  expensesPaid: number;
  incomePending: number;
  incomePaid: number;
  missedCount: number;
};

type DateRange = {
  start: string;
  end: string;
};

const NEIGHBOR_LOOKAROUND_DAYS = 62;
const FALLBACK_HALF_WINDOW_DAYS = 15;
const ESTIMATE_SAMPLE_SIZE = 3;
const MAX_OCCURRENCES = 500;

const STATUS_ORDER: Record<BillStatus, number> = {
  missed: 0,
  due: 1,
  upcoming: 2,
  scheduled: 3,
  paid: 4,
};

export function getBillTransactionsRange(month: string): DateRange {
  return {
    start: monthUtils.subDays(
      monthUtils.firstDayOfMonth(month),
      NEIGHBOR_LOOKAROUND_DAYS * 2,
    ),
    end: monthUtils.addDays(
      monthUtils.lastDayOfMonth(month),
      NEIGHBOR_LOOKAROUND_DAYS,
    ),
  };
}

export function getOccurrenceDates(
  schedule: Pick<BillSchedule, '_conditions'>,
  { start, end }: DateRange,
): string[] {
  const dateCond = extractScheduleConds(schedule._conditions ?? []).date;
  if (!dateCond) {
    return [];
  }

  const dates: string[] = [];
  let cursor = start;

  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const rawDate = getNextDate(dateCond, monthUtils.parseDate(cursor), true);
    if (rawDate == null || rawDate < cursor || rawDate > end) {
      break;
    }

    const date =
      getNextDate(dateCond, monthUtils.parseDate(rawDate)) ?? rawDate;
    if (!dates.includes(date)) {
      dates.push(date);
    }
    cursor = monthUtils.addDays(rawDate, 1);
  }

  return dates;
}

function midpoint(from: string, to: string): string {
  const days = monthUtils.differenceInCalendarDays(to, from);
  return monthUtils.addDays(from, Math.floor(days / 2));
}

function getMatchWindow(
  date: string,
  previous: string | undefined,
  next: string | undefined,
): DateRange {
  return {
    start: previous
      ? monthUtils.addDays(midpoint(previous, date), 1)
      : monthUtils.subDays(date, FALLBACK_HALF_WINDOW_DAYS),
    end: next
      ? midpoint(date, next)
      : monthUtils.addDays(date, FALLBACK_HALF_WINDOW_DAYS),
  };
}

function estimateAmount(
  schedule: BillSchedule,
  transactions: BillTransaction[],
  before: string,
): { amount: number; isEstimate: boolean } {
  if (schedule._amountOp !== 'isbetween') {
    return { amount: getScheduledAmount(schedule._amount), isEstimate: false };
  }

  const recent = transactions
    .filter(transaction => transaction.date < before)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, ESTIMATE_SAMPLE_SIZE);

  if (recent.length === 0) {
    return { amount: getScheduledAmount(schedule._amount), isEstimate: true };
  }

  const total = recent.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  return { amount: Math.round(total / recent.length), isEstimate: true };
}

/**
 * Schedules whose payee is a transfer to a credit card account, mapped to
 * that card's account id.
 */
export function getCardAccountsBySchedule(
  schedules: readonly Pick<BillSchedule, 'id' | '_payee'>[],
  payees: readonly Pick<PayeeEntity, 'id' | 'transfer_acct'>[],
  accounts: readonly Pick<AccountEntity, 'id' | 'closed' | 'kind'>[],
): Map<string, string> {
  const cardAccounts = new Set(
    accounts
      .filter(account => !account.closed && account.kind === 'credit_card')
      .map(account => account.id),
  );
  const transferAccounts = new Map(
    payees.map(payee => [payee.id, payee.transfer_acct]),
  );

  const result = new Map<string, string>();
  for (const schedule of schedules) {
    const account = schedule._payee
      ? transferAccounts.get(schedule._payee)
      : undefined;
    if (account && cardAccounts.has(account)) {
      result.set(schedule.id, account);
    }
  }
  return result;
}

/**
 * The bill a payment this month settles: the one due this month, otherwise
 * the next one still unpaid. Bills are expected oldest due date first.
 */
export function pickCardBill(
  bills: readonly CardBill[],
  month: string,
): CardBill | undefined {
  const monthStart = monthUtils.firstDayOfMonth(month);
  const monthEnd = monthUtils.lastDayOfMonth(month);
  return (
    bills.find(
      bill => bill.dueDate >= monthStart && bill.dueDate <= monthEnd,
    ) ??
    bills.find(
      bill => bill.dueDate >= monthStart && bill.paidAmount < bill.totalAmount,
    )
  );
}

function getScheduleOccurrences({
  schedule,
  transactions,
  month,
  upcomingLength,
  cardBills,
}: {
  schedule: BillSchedule;
  transactions: BillTransaction[];
  month: string;
  upcomingLength: string;
  cardBills?: readonly CardBill[];
}): BillOccurrence[] {
  const monthStart = monthUtils.firstDayOfMonth(month);
  const monthEnd = monthUtils.lastDayOfMonth(month);
  const dates = getOccurrenceDates(schedule, {
    start: monthUtils.subDays(monthStart, NEIGHBOR_LOOKAROUND_DAYS),
    end: monthUtils.addDays(monthEnd, NEIGHBOR_LOOKAROUND_DAYS),
  });

  const ownTransactions = schedule._account
    ? transactions.filter(
        transaction => transaction.account === schedule._account,
      )
    : transactions;

  return dates.flatMap((date, index) => {
    if (date < monthStart || date > monthEnd) {
      return [];
    }

    const window = getMatchWindow(date, dates[index - 1], dates[index + 1]);
    const matched = ownTransactions.filter(
      transaction =>
        transaction.date >= window.start && transaction.date <= window.end,
    );
    const isPaid = matched.length > 0;

    if (!isPaid && (schedule.completed || date < schedule.next_date)) {
      return [];
    }

    const status = getStatus(
      date,
      false,
      isPaid,
      schedule.custom_upcoming_length ?? upcomingLength,
    );
    if (status === 'completed') {
      return [];
    }

    const estimate = estimateAmount(schedule, ownTransactions, window.start);
    const bill = cardBills ? pickCardBill(cardBills, month) : undefined;
    const expected = bill
      ? {
          amount: (Math.sign(estimate.amount) || -1) * bill.totalAmount,
          isEstimate: false,
        }
      : estimate;
    const amount = isPaid
      ? matched.reduce((sum, transaction) => sum + transaction.amount, 0)
      : expected.amount;

    return [
      {
        id: `${schedule.id}-${date}`,
        scheduleId: schedule.id,
        name: schedule.name ?? '',
        date,
        ...(bill ? { billDueDate: bill.dueDate } : {}),
        amount,
        isIncome: expected.amount > 0,
        isEstimate: !isPaid && expected.isEstimate,
        status,
      },
    ];
  });
}

export function getMonthBillOccurrences({
  schedules,
  transactions,
  month,
  upcomingLength,
  cardBillsBySchedule,
}: {
  schedules: readonly BillSchedule[];
  transactions: readonly BillTransaction[];
  month: string;
  upcomingLength: string;
  /** Card bills for schedules that pay a credit card, keyed by schedule id. */
  cardBillsBySchedule?: ReadonlyMap<string, readonly CardBill[]>;
}): BillOccurrence[] {
  const transactionsBySchedule = new Map<string, BillTransaction[]>();
  for (const transaction of transactions) {
    if (!transaction.schedule) {
      continue;
    }
    const list = transactionsBySchedule.get(transaction.schedule) ?? [];
    list.push(transaction);
    transactionsBySchedule.set(transaction.schedule, list);
  }

  return schedules
    .flatMap(schedule =>
      getScheduleOccurrences({
        schedule,
        transactions: transactionsBySchedule.get(schedule.id) ?? [],
        month,
        upcomingLength,
        cardBills: cardBillsBySchedule?.get(schedule.id),
      }),
    )
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.date.localeCompare(b.date) ||
        a.name.localeCompare(b.name),
    );
}

export function getBillTotals(
  occurrences: readonly BillOccurrence[],
): BillTotals {
  return occurrences.reduce<BillTotals>(
    (totals, occurrence) => {
      const isPaid = occurrence.status === 'paid';
      const amount = Math.abs(occurrence.amount);

      if (occurrence.isIncome) {
        if (isPaid) {
          totals.incomePaid += amount;
        } else {
          totals.incomePending += amount;
        }
      } else if (isPaid) {
        totals.expensesPaid += amount;
      } else {
        totals.expensesPending += amount;
      }

      if (occurrence.status === 'missed') {
        totals.missedCount += 1;
      }

      return totals;
    },
    {
      expensesPending: 0,
      expensesPaid: 0,
      incomePending: 0,
      incomePaid: 0,
      missedCount: 0,
    },
  );
}
