import { q } from '@actual-app/core/shared/query';
import { DEFAULT_UPCOMING_SCHEDULE_DAYS } from '@actual-app/core/shared/schedules';
import type {
  ScheduleEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';

import { useAccounts } from '#hooks/useAccounts';
import { useAllCardBills } from '#hooks/useCardBills';
import { usePayees } from '#hooks/usePayees';
import { useQuery } from '#hooks/useQuery';
import { getSchedulesQuery } from '#hooks/useSchedules';
import { useSyncedPref } from '#hooks/useSyncedPref';

import {
  getBillTotals,
  getBillTransactionsRange,
  getCardAccountsBySchedule,
  getMonthBillOccurrences,
} from './billOccurrences';
import type {
  BillOccurrence,
  BillTotals,
  BillTransaction,
  CardBill,
} from './billOccurrences';

/**
 * Bills per card account, oldest first, kept current as card data changes.
 * A card without billing days is left out, so its schedule falls back to the
 * estimate.
 */
function useBillsByCardAccount(accountIds: string[]) {
  const { data } = useAllCardBills(accountIds);
  const billsByAccount = new Map<string, CardBill[]>();
  for (const { accountId, result } of data ?? []) {
    if (result.status === 'ok') {
      billsByAccount.set(
        accountId,
        result.bills.map(bill => ({
          dueDate: bill.effectiveDueDate,
          totalAmount: bill.total,
          paidAmount: bill.paid,
        })),
      );
    }
  }
  return billsByAccount;
}

type UseMonthBillsResult = {
  occurrences: BillOccurrence[];
  totals: BillTotals;
  isLoading: boolean;
};

export type BillScheduleTransaction = BillTransaction &
  Pick<TransactionEntity, 'id' | 'imported_id'>;

/**
 * Schedules, the transactions paying them around a month, and the card each
 * card-bill schedule pays: what the month's bills are computed from.
 */
export function useBillSchedules(month: string) {
  const [upcomingLength = DEFAULT_UPCOMING_SCHEDULE_DAYS] = useSyncedPref(
    'upcomingScheduledTransactionLength',
  );

  const { data: schedules, isLoading: isSchedulesLoading } =
    useQuery<ScheduleEntity>(() => getSchedulesQuery(), []);

  const scheduleIdsKey = (schedules ?? [])
    .map(schedule => schedule.id)
    .join(',');
  const { start, end } = getBillTransactionsRange(month);

  const { data: transactions, isLoading: isTransactionsLoading } =
    useQuery<BillScheduleTransaction>(() => {
      const scheduleIds = scheduleIdsKey ? scheduleIdsKey.split(',') : [];

      return q('transactions')
        .filter(
          scheduleIds.length > 0
            ? {
                $and: [
                  { schedule: { $oneof: scheduleIds } },
                  { date: { $gte: start } },
                  { date: { $lte: end } },
                ],
              }
            : { id: null },
        )
        .options({ splits: 'none' })
        .select(['id', 'schedule', 'date', 'amount', 'account', 'imported_id']);
    }, [scheduleIdsKey, start, end]);

  const { data: accounts = [] } = useAccounts();
  const { data: payees = [] } = usePayees();
  const cardAccountsBySchedule = getCardAccountsBySchedule(
    schedules ?? [],
    payees,
    accounts,
  );

  return {
    schedules: schedules ?? [],
    transactions: transactions ?? [],
    upcomingLength,
    cardAccountsBySchedule,
    isLoading: isSchedulesLoading || isTransactionsLoading,
  };
}

export function useMonthBills(month: string): UseMonthBillsResult {
  const {
    schedules,
    transactions,
    upcomingLength,
    cardAccountsBySchedule,
    isLoading,
  } = useBillSchedules(month);
  const billsByAccount = useBillsByCardAccount(
    [...new Set(cardAccountsBySchedule.values())].sort(),
  );
  const cardBillsBySchedule = new Map<string, CardBill[]>();
  for (const [scheduleId, accountId] of cardAccountsBySchedule) {
    const bills = billsByAccount.get(accountId);
    if (bills) {
      cardBillsBySchedule.set(scheduleId, bills);
    }
  }

  const occurrences = getMonthBillOccurrences({
    schedules,
    transactions,
    month,
    upcomingLength,
    cardBillsBySchedule,
  });

  return {
    occurrences,
    totals: getBillTotals(occurrences),
    isLoading,
  };
}
