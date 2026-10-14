import { addMonths, currentDay } from '#shared/months';
import type { AccountEntity } from '#types/models';

import { classifyEntry } from './engine/classify';
import type { BillStatus, BillSummary, SummaryEntry } from './engine/summary';
import { summarizeBills } from './engine/summary';
import { calendarFor, classifyOptions, toCardEntry } from './reconcile';
import { loadCardAccountState } from './store';

export type CardBill = BillSummary & {
  accountId: AccountEntity['id'];
  id: string;
  providerBillId: string | null;
};

export type CardBillsResult =
  | { status: 'ok'; bills: CardBill[]; currentMonth: string | null }
  | { status: 'not-a-card' | 'needs-schedule'; bills: []; currentMonth: null };

const OPEN_LIKE: BillStatus[] = ['open', 'upcoming'];

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
    return { status: 'not-a-card', bills: [], currentMonth: null };
  }
  const calendar = calendarFor(state);
  if (!calendar) {
    return { status: 'needs-schedule', bills: [], currentMonth: null };
  }

  const options = classifyOptions(state);
  const entries: SummaryEntry[] = state.transactions.map(transaction => {
    const entry = toCardEntry(accountId, transaction);
    return {
      date: entry.date,
      amount: entry.amount,
      kind: entry.stored.kind ?? classifyEntry(entry, options),
      bill: entry.stored.bill ?? calendar.monthForDate(entry.date),
      projected: entry.projected,
    };
  });

  const openMonth = calendar.monthForDate(today);
  const months = new Set<string>([openMonth]);
  for (const entry of entries) {
    if (entry.kind !== 'payment') {
      months.add(entry.bill);
    }
  }
  for (const bill of state.bills) {
    months.add(bill.reference_month);
  }

  const summaries = summarizeBills(
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
  };
}
