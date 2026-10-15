import * as monthUtils from '@actual-app/core/shared/months';

import { getMonthBillOccurrences } from '#components/reports/reports/bills/billOccurrences';
import type { CardBill } from '#components/reports/reports/bills/billOccurrences';
import { useBillSchedules } from '#components/reports/reports/bills/useMonthBills';
import { useAccounts } from '#hooks/useAccounts';
import { useAllCardBills } from '#hooks/useCardBills';

import { getHomeBillTotals, mergeHomeBills } from './homeBills';
import type { HomeCard } from './homeBills';

/**
 * Schedules whose payment in the month was recorded in a bank-synced
 * account and has no bank copy yet.
 */
function awaitingBank(
  transactions: ReturnType<typeof useBillSchedules>['transactions'],
  syncedAccounts: ReadonlySet<string>,
  month: string,
) {
  const start = monthUtils.firstDayOfMonth(month);
  const end = monthUtils.lastDayOfMonth(month);
  return new Set(
    transactions
      .filter(
        transaction =>
          transaction.schedule != null &&
          transaction.date >= start &&
          transaction.date <= end &&
          !transaction.imported_id &&
          syncedAccounts.has(transaction.account),
      )
      .map(transaction => transaction.schedule as string),
  );
}

/** The month's bills and card bills, merged, with their totals. */
export function useHomeBills(month: string) {
  const {
    schedules,
    transactions,
    upcomingLength,
    cardAccountsBySchedule,
    isLoading: isSchedulesLoading,
  } = useBillSchedules(month);
  const { data: accounts = [] } = useAccounts();
  const cardAccounts = accounts.filter(
    account => account.kind === 'credit_card' && !account.closed,
  );
  const { data: cardResults, isLoading: isCardsLoading } = useAllCardBills(
    cardAccounts.map(account => account.id),
  );

  const cards: HomeCard[] = (cardResults ?? []).flatMap(
    ({ accountId, result }) =>
      result.status === 'ok'
        ? [
            {
              accountId,
              name:
                cardAccounts.find(account => account.id === accountId)?.name ??
                '',
              bills: result.bills,
              currentMonth: result.currentMonth,
              available: result.limit.available,
            },
          ]
        : [],
  );

  const cardBillsBySchedule = new Map<string, CardBill[]>();
  for (const [scheduleId, accountId] of cardAccountsBySchedule) {
    const card = cards.find(row => row.accountId === accountId);
    if (card) {
      cardBillsBySchedule.set(
        scheduleId,
        card.bills.map(bill => ({
          dueDate: bill.effectiveDueDate,
          totalAmount: bill.total,
          paidAmount: bill.paid,
        })),
      );
    }
  }

  const occurrences = getMonthBillOccurrences({
    schedules,
    transactions,
    month,
    upcomingLength,
    cardBillsBySchedule,
  });

  const bills = mergeHomeBills({
    occurrences,
    month,
    cardAccountsBySchedule,
    scheduleAccounts: new Map(
      schedules.map(schedule => [schedule.id, schedule._account ?? null]),
    ),
    cards,
    awaitingBankScheduleIds: awaitingBank(
      transactions,
      new Set(
        accounts
          .filter(account => account.account_sync_source)
          .map(account => account.id),
      ),
      month,
    ),
  });

  return {
    bills,
    totals: getHomeBillTotals(bills),
    cards,
    isLoading: isSchedulesLoading || isCardsLoading,
  };
}
