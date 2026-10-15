import * as monthUtils from './months';
import { q } from './query';

/** Amount per category in one budget month, in cents. */
export type BudgetSpendingRow = {
  month: string;
  category: string;
  amount: number;
};

/** Amount per category on one budget day, in cents. */
export type BudgetDailySpendingRow = {
  date: string;
  category: string;
  amount: number;
};

/**
 * Transactions counted in the budget's spent and received cells between two
 * months, inclusive: on-budget, categorized, by budget date (card charges in
 * the month their bill is due, projected installments included). The filters
 * mirror `sum-amount` in `server/budget/base.ts`, so the totals match the
 * budget page.
 */
function budgetTransactions(startMonth: string, endMonth: string) {
  return q('transactions')
    .filter({
      // One entry per bound: AQL reads only the first operator of an object.
      $and: [
        { budget_date: { $gte: monthUtils.firstDayOfMonth(startMonth) } },
        { budget_date: { $lte: monthUtils.lastDayOfMonth(endMonth) } },
        { category: { $ne: null } },
        { 'account.offbudget': false },
      ],
    })
    .options({ splits: 'inline' });
}

export function budgetSpendingByMonthQuery(
  startMonth: string,
  endMonth: string,
) {
  return budgetTransactions(startMonth, endMonth)
    .groupBy([{ $month: '$budget_date' }, { $id: '$category' }])
    .select([
      { month: { $month: '$budget_date' } },
      { category: { $id: '$category' } },
      { amount: { $sum: '$amount' } },
    ]);
}

export function budgetSpendingByDayQuery(startMonth: string, endMonth: string) {
  return budgetTransactions(startMonth, endMonth)
    .groupBy([{ $id: '$budget_date' }, { $id: '$category' }])
    .select([
      { date: { $id: '$budget_date' } },
      { category: { $id: '$category' } },
      { amount: { $sum: '$amount' } },
    ]);
}
