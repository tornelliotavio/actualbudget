import { send } from '@actual-app/core/platform/client/connection';
import { q } from '@actual-app/core/shared/query';
import { DEFAULT_UPCOMING_SCHEDULE_DAYS } from '@actual-app/core/shared/schedules';
import type { ScheduleEntity } from '@actual-app/core/types/models';
import { useQuery as useAsyncQuery } from '@tanstack/react-query';

import { useAccounts } from '#hooks/useAccounts';
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

const CARD_BILLS_STALE_MS = 30 * 1000;

/**
 * Bills per card account, oldest first. A card without billing days is left
 * out, so its schedule falls back to the estimate.
 */
function useCardBills(accountIds: string[]) {
  return useAsyncQuery({
    queryKey: ['credit-card-bills-by-account', ...accountIds],
    queryFn: async () => {
      const entries = await Promise.all(
        accountIds.map(async accountId => {
          const result = await send('credit-card-bills', { accountId });
          if (result.status !== 'ok') {
            return null;
          }
          const bills: CardBill[] = result.bills.map(bill => ({
            dueDate: bill.effectiveDueDate,
            totalAmount: bill.total,
            paidAmount: bill.paid,
          }));
          return [accountId, bills] as const;
        }),
      );
      return new Map<string, CardBill[]>(
        entries.filter(entry => entry !== null),
      );
    },
    enabled: accountIds.length > 0,
    staleTime: CARD_BILLS_STALE_MS,
  });
}

type UseMonthBillsResult = {
  occurrences: BillOccurrence[];
  totals: BillTotals;
  isLoading: boolean;
};

export function useMonthBills(month: string): UseMonthBillsResult {
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
    useQuery<BillTransaction>(() => {
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
        .select(['schedule', 'date', 'amount', 'account']);
    }, [scheduleIdsKey, start, end]);

  const { data: accounts = [] } = useAccounts();
  const { data: payees = [] } = usePayees();
  const cardAccountsBySchedule = getCardAccountsBySchedule(
    schedules ?? [],
    payees,
    accounts,
  );
  const { data: billsByAccount } = useCardBills(
    [...new Set(cardAccountsBySchedule.values())].sort(),
  );
  const cardBillsBySchedule = new Map<string, CardBill[]>();
  for (const [scheduleId, accountId] of cardAccountsBySchedule) {
    const bills = billsByAccount?.get(accountId);
    if (bills) {
      cardBillsBySchedule.set(scheduleId, bills);
    }
  }

  const occurrences = getMonthBillOccurrences({
    schedules: schedules ?? [],
    transactions: transactions ?? [],
    month,
    upcomingLength,
    cardBillsBySchedule,
  });

  return {
    occurrences,
    totals: getBillTotals(occurrences),
    isLoading: isSchedulesLoading || isTransactionsLoading,
  };
}
