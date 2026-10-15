import {
  budgetSpendingByDayQuery,
  budgetSpendingByMonthQuery,
} from '@actual-app/core/shared/budget-spending';
import type {
  BudgetDailySpendingRow,
  BudgetSpendingRow,
} from '@actual-app/core/shared/budget-spending';
import * as monthUtils from '@actual-app/core/shared/months';

import { useQuery } from '#hooks/useQuery';
import { uncategorizedTransactions } from '#queries';

export const TREND_MONTHS = 12;

/**
 * Budget-month spending per category for the month and the year before it,
 * live. One query feeds the category list, its averages and the trend.
 */
export function useBudgetSpending(month: string) {
  const startMonth = monthUtils.subMonths(month, TREND_MONTHS - 1);
  const { data, isLoading } = useQuery<BudgetSpendingRow>(
    () => budgetSpendingByMonthQuery(startMonth, month),
    [startMonth, month],
  );
  return { rows: data ?? [], isLoading };
}

/** Daily spending per category in the month and the month before. */
export function useDailyBudgetSpending(month: string) {
  const previousMonth = monthUtils.subMonths(month, 1);
  const { data, isLoading } = useQuery<BudgetDailySpendingRow>(
    () => budgetSpendingByDayQuery(previousMonth, month),
    [previousMonth, month],
  );
  return { rows: data ?? [], isLoading };
}

/**
 * On-budget transactions in the budget month that still need a category;
 * the budget leaves them out of every total.
 */
export function useUncategorizedCount(month: string) {
  const { data } = useQuery<number>(
    () =>
      uncategorizedTransactions()
        .filter({
          $and: [
            { budget_date: { $gte: monthUtils.firstDayOfMonth(month) } },
            { budget_date: { $lte: monthUtils.lastDayOfMonth(month) } },
          ],
        })
        .calculate({ $count: '$id' }),
    [month],
  );
  return typeof data === 'number' ? data : 0;
}
