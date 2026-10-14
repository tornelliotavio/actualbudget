import { addMonths, currentDay } from '#shared/months';
import type { AccountEntity } from '#types/models';

import { calendarFor, classifyOptions, toCardEntry } from './card-entries';
import type { BillCalendar } from './engine/bill-calendar';
import { classifyEntry } from './engine/classify';
import type { BillStatus, BillSummary, SummaryEntry } from './engine/summary';
import { summarizeBills } from './engine/summary';
import type { DateString } from './engine/types';
import { loadCardAccountState } from './store';
import type { CardAccountState } from './store';

export type CardBill = BillSummary & {
  accountId: AccountEntity['id'];
  id: string;
  providerBillId: string | null;
};

export type CardLimit = {
  /** The user's figure, otherwise the bank's. */
  total: number | null;
  /** What the card owes, projected installments included. */
  used: number;
  available: number | null;
};

export type CardBillsResult =
  | {
      status: 'ok';
      bills: CardBill[];
      currentMonth: string | null;
      limit: CardLimit;
    }
  | {
      status: 'not-a-card' | 'needs-schedule';
      bills: [];
      currentMonth: null;
      limit: CardLimit | null;
    };

const OPEN_LIKE: BillStatus[] = ['open', 'upcoming'];

/**
 * Bill summaries of a card from its stored transactions, leaving out the
 * transactions in `exclude`.
 */
export function summarizeCardState(
  state: CardAccountState,
  calendar: BillCalendar,
  today: DateString,
  exclude: ReadonlySet<string> = new Set(),
): BillSummary[] {
  const options = classifyOptions(state);
  const accountId = state.account.id;
  const entries: SummaryEntry[] = state.transactions
    .filter(transaction => !exclude.has(transaction.id))
    .map(transaction => {
      const entry = toCardEntry(accountId, transaction);
      return {
        date: entry.date,
        amount: entry.amount,
        kind: entry.stored.kind ?? classifyEntry(entry, options),
        bill: entry.stored.bill ?? calendar.monthForDate(entry.date),
        projected: entry.projected,
      };
    });

  const months = new Set<string>([calendar.monthForDate(today)]);
  for (const entry of entries) {
    if (entry.kind !== 'payment') {
      months.add(entry.bill);
    }
  }
  for (const bill of state.bills) {
    months.add(bill.reference_month);
  }

  return summarizeBills(
    calendar,
    entries,
    state.bills.map(bill => ({
      referenceMonth: bill.reference_month,
      providerTotal: bill.provider_total,
      userTotal: bill.total_user,
      minimumPayment: bill.provider_minimum,
    })),
    [...months],
    today,
    entries
      .filter(entry => !entry.projected)
      .reduce<string | null>(
        (earliest, entry) =>
          earliest == null || entry.date < earliest ? entry.date : earliest,
        null,
      ),
  );
}

/**
 * Bills of a credit card account from the earliest month with a transaction
 * to the last projected installment. `currentMonth` is the bill the card
 * screen opens on: the oldest closed bill still unpaid, otherwise the open
 * one.
 */
export async function getCardBills(
  accountId: AccountEntity['id'],
  { today = currentDay() }: { today?: string } = {},
): Promise<CardBillsResult> {
  const state = await loadCardAccountState(accountId);
  if (!state) {
    return {
      status: 'not-a-card',
      bills: [],
      currentMonth: null,
      limit: null,
    };
  }
  const limit = cardLimit(state);
  const calendar = calendarFor(state);
  if (!calendar) {
    return { status: 'needs-schedule', bills: [], currentMonth: null, limit };
  }

  const openMonth = calendar.monthForDate(today);
  const summaries = summarizeCardState(state, calendar, today);

  const providerIds = new Map(
    state.bills.map(bill => [bill.reference_month, bill.provider_bill_id]),
  );
  const bills: CardBill[] = summaries.map(summary => ({
    ...summary,
    accountId,
    id: `${accountId}:${summary.referenceMonth}`,
    providerBillId: providerIds.get(summary.referenceMonth) ?? null,
  }));

  const unpaid = bills.find(
    bill =>
      !OPEN_LIKE.includes(bill.status) &&
      bill.remaining > 0 &&
      !bill.carriedOver &&
      bill.referenceMonth >= addMonths(openMonth, -2),
  );

  return {
    status: 'ok',
    bills,
    currentMonth: unpaid?.referenceMonth ?? openMonth,
    limit,
  };
}

function cardLimit(state: CardAccountState): CardLimit {
  const total =
    state.profile?.credit_limit_user ?? state.account.balance_limit ?? null;
  const used = -state.transactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  return { total, used, available: total == null ? null : total - used };
}
