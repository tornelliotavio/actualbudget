import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import * as sheet from '#server/sheet';
import {
  budgetSpendingByDayQuery,
  budgetSpendingByMonthQuery,
} from '#shared/budget-spending';
import type {
  BudgetDailySpendingRow,
  BudgetSpendingRow,
} from '#shared/budget-spending';
import * as monthUtils from '#shared/months';

import { createAllBudgets } from './base';

beforeEach(() => {
  global.currentMonth = '2026-10';
  return global.emptyDatabase()();
});

afterEach(() => {
  global.currentMonth = null;
});

async function setUpBudget() {
  await sheet.loadSpreadsheet(db);
  sheet.get().meta().budgetType = 'tracking';

  await db.insertCategoryGroup({ id: 'group', name: 'Expenses' });
  await db.insertCategoryGroup({ id: 'income', name: 'Income', is_income: 1 });
  const food = await db.insertCategory({ name: 'Food', cat_group: 'group' });
  const fuel = await db.insertCategory({ name: 'Fuel', cat_group: 'group' });
  const salary = await db.insertCategory({
    name: 'Salary',
    cat_group: 'income',
    is_income: 1,
  });
  await db.insertAccount({ id: 'checking', name: 'Checking' });
  await db.insertAccount({ id: 'card', name: 'Card' });
  await db.insertAccount({ id: 'savings', name: 'Savings', offbudget: 1 });
  await db.insertPayee({
    id: 'to-savings',
    name: '',
    transfer_acct: 'savings',
  });

  await db.insertTransaction({
    account: 'checking',
    date: '2026-09-05',
    amount: -1000,
    category: food,
  });
  // Card charge counted in the month its bill is due.
  await db.insertTransaction({
    account: 'card',
    date: '2026-09-28',
    budget_date: '2026-10-10',
    amount: -2500,
    category: fuel,
  });
  // Projected installment.
  await db.insertTransaction({
    account: 'card',
    date: '2026-10-11',
    budget_date: '2026-11-10',
    amount: -19500,
    category: fuel,
    projected: true,
  });
  await db.insertTransaction({
    account: 'checking',
    date: '2026-10-01',
    amount: 500000,
    category: salary,
  });
  // A split counts through its children.
  await db.insertTransaction({
    id: 'split',
    account: 'checking',
    date: '2026-10-03',
    amount: -3000,
    is_parent: true,
  });
  await db.insertTransaction({
    account: 'checking',
    date: '2026-10-03',
    amount: -1000,
    category: food,
    is_child: true,
    parent_id: 'split',
  });
  await db.insertTransaction({
    account: 'checking',
    date: '2026-10-03',
    amount: -2000,
    category: fuel,
    is_child: true,
    parent_id: 'split',
  });
  // Off budget, uncategorized transfer and deleted rows are left out.
  await db.insertTransaction({
    account: 'savings',
    date: '2026-10-04',
    amount: -700,
    category: food,
  });
  await db.insertTransaction({
    account: 'checking',
    date: '2026-10-04',
    amount: -10000,
    payee: 'to-savings',
  });
  const deleted = await db.insertTransaction({
    account: 'checking',
    date: '2026-10-05',
    amount: -900,
    category: food,
  });
  await db.deleteTransaction({ id: deleted });

  await createAllBudgets();
  await sheet.waitOnSpreadsheet();
  return { food, fuel, salary };
}

describe('budget spending queries', () => {
  it('add up to the budget sheet per category and month', async () => {
    const categories = Object.values(await setUpBudget());
    const months = ['2026-09', '2026-10', '2026-11'];

    const { data } = (await aqlQuery(
      budgetSpendingByMonthQuery('2026-09', '2026-11'),
    )) as { data: BudgetSpendingRow[] };

    for (const month of months) {
      for (const category of categories) {
        const fromQuery =
          data.find(row => row.month === month && row.category === category)
            ?.amount ?? 0;
        expect([month, category, fromQuery]).toEqual([
          month,
          category,
          sheet.getCellValue(
            monthUtils.sheetForMonth(month),
            `sum-amount-${category}`,
          ),
        ]);
      }
    }
    expect(data.length).toBeGreaterThan(0);
  });

  it('places card charges on their budget day', async () => {
    const { fuel } = await setUpBudget();

    const { data } = (await aqlQuery(
      budgetSpendingByDayQuery('2026-10', '2026-10'),
    )) as { data: BudgetDailySpendingRow[] };

    expect(
      data
        .filter(row => row.category === fuel)
        .map(row => [row.date, row.amount]),
    ).toEqual([
      ['2026-10-03', -2000],
      ['2026-10-10', -2500],
    ]);
  });
});
