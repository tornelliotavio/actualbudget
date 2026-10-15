import {
  averageMonths,
  buildCumulative,
  buildMonthlyTrend,
  buildMonthSpending,
} from './spendingModel';

const groups = [
  {
    id: 'food',
    name: 'Food',
    is_income: false,
    hidden: false,
    categories: [
      { id: 'market', name: 'Market', hidden: false },
      { id: 'restaurants', name: 'Restaurants', hidden: false },
    ],
  },
  {
    id: 'car',
    name: 'Car',
    is_income: false,
    hidden: false,
    categories: [{ id: 'fuel', name: 'Fuel', hidden: true }],
  },
  {
    id: 'income',
    name: 'Income',
    is_income: true,
    hidden: false,
    categories: [{ id: 'salary', name: 'Salary', hidden: false }],
  },
] as never;

const rows = [
  { month: '2026-07', category: 'market', amount: -30000 },
  { month: '2026-08', category: 'market', amount: -60000 },
  // September had no market spending: the average still counts it.
  { month: '2026-09', category: 'restaurants', amount: -9000 },
  { month: '2026-10', category: 'market', amount: -50000 },
  { month: '2026-10', category: 'restaurants', amount: -4000 },
  { month: '2026-10', category: 'restaurants', amount: 1000 },
  { month: '2026-10', category: 'fuel', amount: -20000 },
  { month: '2026-10', category: 'salary', amount: 700000 },
];

describe('averageMonths', () => {
  it('takes the three full months before, from the first month with data', () => {
    expect(averageMonths(rows, '2026-10')).toEqual([
      '2026-09',
      '2026-08',
      '2026-07',
    ]);
    expect(averageMonths(rows, '2026-08')).toEqual(['2026-07']);
    expect(averageMonths(rows, '2026-07')).toEqual([]);
  });
});

describe('buildMonthSpending', () => {
  it('gives spent per category and group with the 3-month average', () => {
    const spending = buildMonthSpending({ rows, groups, month: '2026-10' });

    const [food, car] = spending.expenseGroups;
    expect(food).toMatchObject({ amount: 53000, average: 33000 });
    expect(food.categories).toMatchObject([
      { id: 'market', amount: 50000, average: 30000 },
      { id: 'restaurants', amount: 3000, average: 3000 },
    ]);
    expect(car).toMatchObject({ amount: 20000, average: 0 });
    expect(car.categories[0].hidden).toBe(true);
    expect(spending.spent).toBe(73000);
    expect(spending.spentAverage).toBe(33000);
    expect(spending.income).toBe(700000);
    expect(spending.incomeGroups[0].amount).toBe(700000);
  });

  it('has no average without history', () => {
    const spending = buildMonthSpending({ rows, groups, month: '2026-07' });
    expect(spending.spentAverage).toBeNull();
    expect(spending.expenseGroups[0].categories[0].average).toBeNull();
  });
});

describe('buildMonthlyTrend', () => {
  it('adds the spending of the selected categories per month', () => {
    const months = ['2026-08', '2026-09', '2026-10'];
    expect(
      buildMonthlyTrend({ rows, groups, months, filter: { type: 'all' } }),
    ).toEqual([
      { month: '2026-08', spent: 60000 },
      { month: '2026-09', spent: 9000 },
      { month: '2026-10', spent: 73000 },
    ]);
    expect(
      buildMonthlyTrend({
        rows,
        groups,
        months,
        filter: { type: 'category', id: 'fuel' },
      }).map(point => point.spent),
    ).toEqual([0, 0, 20000]);
    expect(
      buildMonthlyTrend({
        rows,
        groups,
        months,
        filter: { type: 'group', id: 'food' },
      }).map(point => point.spent),
    ).toEqual([60000, 9000, 53000]);
  });
});

describe('buildCumulative', () => {
  it('accumulates by day and stops at today in the current month', () => {
    const daily = [
      { date: '2026-09-02', category: 'market', amount: -1000 },
      { date: '2026-09-30', category: 'market', amount: -500 },
      { date: '2026-10-01', category: 'market', amount: -2000 },
      { date: '2026-10-03', category: 'fuel', amount: -3000 },
      { date: '2026-10-03', category: 'salary', amount: 700000 },
      { date: '2026-10-20', category: 'market', amount: -9999 },
    ];

    const points = buildCumulative({
      rows: daily,
      groups,
      month: '2026-10',
      today: '2026-10-15',
    });

    expect(points).toHaveLength(31);
    expect(points.slice(0, 3)).toEqual([
      { day: 1, current: 2000, previous: 0 },
      { day: 2, current: 2000, previous: 1000 },
      { day: 3, current: 5000, previous: 1000 },
    ]);
    expect(points[14]).toEqual({ day: 15, current: 5000, previous: 1000 });
    expect(points[15].current).toBeNull();
    expect(points[29].previous).toBe(1500);
    expect(points[30]).toEqual({ day: 31, current: null, previous: null });
  });
});
