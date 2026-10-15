import type {
  BudgetDailySpendingRow,
  BudgetSpendingRow,
} from '@actual-app/core/shared/budget-spending';
import * as monthUtils from '@actual-app/core/shared/months';
import type {
  CategoryEntity,
  CategoryGroupEntity,
} from '@actual-app/core/types/models';

export const AVERAGE_MONTHS = 3;

export type CategorySpending = {
  id: string;
  name: string;
  hidden: boolean;
  /** Spent (or received, for income) in the month, positive cents. */
  amount: number;
  /** Monthly average of the months before; null without history. */
  average: number | null;
};

export type GroupSpending = CategorySpending & {
  isIncome: boolean;
  categories: CategorySpending[];
};

export type MonthSpending = {
  expenseGroups: GroupSpending[];
  incomeGroups: GroupSpending[];
  /** All expense categories, hidden ones included, as the budget totals. */
  spent: number;
  spentAverage: number | null;
  income: number;
};

type Groups = readonly Pick<
  CategoryGroupEntity,
  'id' | 'name' | 'is_income' | 'hidden' | 'categories'
>[];

/** Sums per `month|category`, signed as the budget stores them. */
function indexRows(rows: readonly BudgetSpendingRow[]) {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.month}|${row.category}`;
    sums.set(key, (sums.get(key) ?? 0) + row.amount);
  }
  return sums;
}

/**
 * The months the average covers: the full months before `month`, never
 * before the first month with data, so a budget started recently isn't
 * averaged against months it has no data for. Months without spending count.
 */
export function averageMonths(
  rows: readonly BudgetSpendingRow[],
  month: string,
  count = AVERAGE_MONTHS,
): string[] {
  const firstMonth = rows.reduce<string | null>(
    (first, row) => (first == null || row.month < first ? row.month : first),
    null,
  );
  if (firstMonth == null) {
    return [];
  }
  return Array.from({ length: count }, (_, index) =>
    monthUtils.subMonths(month, index + 1),
  ).filter(candidate => candidate >= firstMonth);
}

export function buildMonthSpending({
  rows,
  groups,
  month,
}: {
  rows: readonly BudgetSpendingRow[];
  groups: Groups;
  month: string;
}): MonthSpending {
  const sums = indexRows(rows);
  const history = averageMonths(rows, month);

  const categorySpending = (
    category: Pick<CategoryEntity, 'id' | 'name' | 'hidden'>,
    sign: number,
  ): CategorySpending => {
    // `+ 0` turns the -0 of an expense category without spending into 0.
    const amountIn = (m: string) =>
      sign * (sums.get(`${m}|${category.id}`) ?? 0) + 0;
    return {
      id: category.id,
      name: category.name,
      hidden: Boolean(category.hidden),
      amount: amountIn(month),
      average:
        history.length > 0
          ? Math.round(
              history.reduce((sum, m) => sum + amountIn(m), 0) / history.length,
            )
          : null,
    };
  };

  const toGroup = (group: Groups[number]): GroupSpending => {
    const isIncome = Boolean(group.is_income);
    const categories = (group.categories ?? []).map(category =>
      categorySpending(category, isIncome ? 1 : -1),
    );
    const sumOf = (pick: (category: CategorySpending) => number | null) =>
      categories.reduce((sum, category) => sum + (pick(category) ?? 0), 0);
    return {
      id: group.id,
      name: group.name,
      hidden: Boolean(group.hidden),
      isIncome,
      amount: sumOf(category => category.amount),
      average: history.length > 0 ? sumOf(category => category.average) : null,
      categories,
    };
  };

  const all = groups.map(toGroup);
  const expenseGroups = all.filter(group => !group.isIncome);
  const incomeGroups = all.filter(group => group.isIncome);
  const total = (
    list: GroupSpending[],
    pick: (g: GroupSpending) => number | null,
  ) => list.reduce((sum, group) => sum + (pick(group) ?? 0), 0);

  return {
    expenseGroups,
    incomeGroups,
    spent: total(expenseGroups, group => group.amount),
    spentAverage:
      history.length > 0 ? total(expenseGroups, group => group.average) : null,
    income: total(incomeGroups, group => group.amount),
  };
}

export type TrendFilter =
  | { type: 'all' }
  | { type: 'group'; id: string }
  | { type: 'category'; id: string };

export type TrendPoint = { month: string; spent: number };

/** Expense categories a trend filter selects. */
export function filteredCategoryIds(groups: Groups, filter: TrendFilter) {
  const expenseGroups = groups.filter(group => !group.is_income);
  switch (filter.type) {
    case 'all':
      return expenseGroups.flatMap(group =>
        (group.categories ?? []).map(category => category.id),
      );
    case 'group':
      return (
        expenseGroups
          .find(group => group.id === filter.id)
          ?.categories?.map(category => category.id) ?? []
      );
    case 'category':
      return [filter.id];
    default:
      return filter satisfies never;
  }
}

/** Spending per month for the selected categories, oldest first. */
export function buildMonthlyTrend({
  rows,
  groups,
  months,
  filter,
}: {
  rows: readonly BudgetSpendingRow[];
  groups: Groups;
  months: readonly string[];
  filter: TrendFilter;
}): TrendPoint[] {
  const categories = new Set(filteredCategoryIds(groups, filter));
  const spentByMonth = new Map<string, number>();
  for (const row of rows) {
    if (categories.has(row.category)) {
      spentByMonth.set(
        row.month,
        (spentByMonth.get(row.month) ?? 0) - row.amount,
      );
    }
  }
  return months.map(month => ({ month, spent: spentByMonth.get(month) ?? 0 }));
}

export type CumulativePoint = {
  day: number;
  current: number | null;
  previous: number | null;
};

/**
 * Spending accumulated day by day in a month and in the month before, for
 * the selected categories. Days after today are left empty for the month in
 * progress.
 */
export function buildCumulative({
  rows,
  groups,
  month,
  today,
  filter = { type: 'all' },
}: {
  rows: readonly BudgetDailySpendingRow[];
  groups: Groups;
  month: string;
  today: string;
  filter?: TrendFilter;
}): CumulativePoint[] {
  const previousMonth = monthUtils.subMonths(month, 1);
  const categories = new Set(filteredCategoryIds(groups, filter));
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (categories.has(row.category)) {
      byDay.set(row.date, (byDay.get(row.date) ?? 0) - row.amount);
    }
  }

  const daysIn = (m: string) =>
    Number(monthUtils.lastDayOfMonth(m).slice(8, 10));
  const length = Math.max(daysIn(month), daysIn(previousMonth));
  const accumulate = (m: string, lastDay: number, stopAfter: string | null) => {
    let running = 0;
    return Array.from({ length }, (_, index) => {
      const day = index + 1;
      if (day > lastDay) {
        return null;
      }
      const date = `${m}-${String(day).padStart(2, '0')}`;
      if (stopAfter != null && date > stopAfter) {
        return null;
      }
      running += byDay.get(date) ?? 0;
      return running;
    });
  };

  const current = accumulate(
    month,
    daysIn(month),
    month === monthUtils.monthFromDate(today) ? today : null,
  );
  const previous = accumulate(previousMonth, daysIn(previousMonth), null);
  return current.map((value, index) => ({
    day: index + 1,
    current: value,
    previous: previous[index],
  }));
}
