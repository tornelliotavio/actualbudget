import * as api from '@actual-app/api';

import type { Lib } from '#budget';
import { cardBillDue, loadCards } from '#tools/card-bills';
import { between } from '#tools/format';
import { loadLookups } from '#tools/lookups';
import { loadAccountBalances } from '#tools/overview';
import { linkedTransactions } from '#tools/schedules';

import {
  limitReceipts,
  pendingCardBills,
  pendingSchedules,
  receiptLabel,
  sortPendingBills,
  splitCash,
  summarizeSpending,
} from './summarize';
import type { CardBillInput, SpendingRow } from './summarize';
import type {
  MonthAmount,
  Receipt,
  ReportAccount,
  ReportCard,
  ReportData,
} from './types';

const RECEIPTS_SHOWN = 14;
const DUE_MONTHS_SHOWN = 3;

export type CollectOptions = {
  today: string;
  /** Categories that only move money around, kept out of the totals. */
  ignoredCategories: readonly string[];
  /** Accounts whose money isn't meant for this month's bills. */
  setAsideAccounts: readonly string[];
};

function monthBounds(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, monthIndex, 0));
  return { start: `${month}-01`, end: end.toISOString().slice(0, 10) };
}

function monthBefore(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 2, 1));
  return date.toISOString().slice(0, 7);
}

/**
 * Amounts per category by budget date with projected installments included,
 * mirroring `budgetSpendingByMonthQuery` in loot-core so the totals match the
 * app's overview. Unlike the overview, money out with no category counts too;
 * money in without one is left out so it can't hide that spending.
 */
async function spendingRows(months: readonly string[]): Promise<SpendingRow[]> {
  const rows: SpendingRow[] = [];
  for (const month of months) {
    const { start, end } = monthBounds(month);
    const { data } = (await api.aqlQuery(
      api
        .q('transactions')
        .filter({
          $and: [
            { budget_date: { $gte: start } },
            { budget_date: { $lte: end } },
            { 'account.offbudget': false },
            {
              $or: [
                { category: { $ne: null } },
                { $and: [{ transfer_id: null }, { amount: { $lt: 0 } }] },
              ],
            },
          ],
        })
        .options({ splits: 'inline' })
        .groupBy('category')
        .select([{ category: 'category' }, { amount: { $sum: '$amount' } }]),
    )) as { data: { category: string | null; amount: number }[] };
    rows.push(...data.map(row => ({ ...row, month })));
  }
  return rows;
}

async function collectReceipts(
  start: string,
  end: string,
  cashAccounts: ReadonlySet<string>,
  incomeCategories: ReadonlySet<string>,
  ignoredCategories: ReadonlySet<string>,
): Promise<Receipt[]> {
  const lookups = await loadLookups();
  const { data } = (await api.aqlQuery(
    api
      .q('transactions')
      .filter({
        date: between(start, end),
        amount: { $gt: 0 },
        transfer_id: null,
        projected: false,
      })
      .options({ splits: 'inline' })
      .select(['date', 'account', 'payee', 'notes', 'category', 'amount']),
  )) as {
    data: {
      date: string;
      account: string;
      payee: string | null;
      notes: string | null;
      category: string | null;
      amount: number;
    }[];
  };

  return data
    .filter(row => cashAccounts.has(row.account))
    .filter(row => !row.category || !ignoredCategories.has(row.category))
    .map(row => ({
      date: row.date,
      label: receiptLabel(lookups.payeeName(row.payee), row.notes),
      account: lookups.accountName(row.account) ?? '',
      category: lookups.categoryName(row.category),
      kind: !row.category
        ? ('uncategorized' as const)
        : incomeCategories.has(row.category)
          ? ('income' as const)
          : ('credit' as const),
      amount: row.amount,
    }));
}

function describeAccounts(
  accounts: Awaited<ReturnType<typeof loadAccountBalances>>,
  setAsideAccounts: readonly string[],
): ReportAccount[] {
  const setAside = new Set(setAsideAccounts.map(n => n.toLocaleLowerCase()));
  return accounts
    .filter(account => !account.offbudget)
    .map(account => {
      const isCard = account.kind === 'credit_card';
      // A card's bank balance counts the installments still to come.
      const compared = isCard
        ? account.balanceIncludingFuture
        : account.balance;
      return {
        name: account.name,
        isCard,
        isSetAside: setAside.has(account.name.toLocaleLowerCase()),
        balance: compared,
        bankReported: account.account_sync_source ? account.bankReported : null,
        bankDifference:
          account.account_sync_source && account.bankReported != null
            ? compared - account.bankReported
            : 0,
      };
    });
}

/** Everything the daily report shows. Run inside a budget session. */
export async function collectReport(
  lib: Lib,
  { today, ignoredCategories, setAsideAccounts }: CollectOptions,
): Promise<ReportData> {
  const month = today.slice(0, 7);
  const previousMonth = monthBefore(month);
  const { start, end } = monthBounds(month);

  const [schedules, payees, linked, groups, categories] = [
    await api.getSchedules(),
    await api.getPayees(),
    await linkedTransactions(),
    await api.getCategoryGroups(),
    await api.getCategories(),
  ];
  const balances = await loadAccountBalances(today);
  const cardIds = new Set(
    balances.filter(a => a.kind === 'credit_card').map(a => a.id),
  );
  const payeesToCards = new Set(
    payees
      .filter(p => p.transfer_acct && cardIds.has(p.transfer_acct))
      .map(p => p.id),
  );

  // A card's own bill is the truth about what it costs; the schedules that
  // pay cards only hold estimates, so they would count it twice.
  const billSchedules = schedules.filter(
    schedule => !schedule.payee || !payeesToCards.has(schedule.payee),
  );
  const billScheduleIds = new Set(billSchedules.map(s => s.id));
  const scheduleBills = pendingSchedules(
    billSchedules.map(schedule => ({
      name: schedule.name ?? '',
      nextDate: schedule.next_date ?? today,
      completed: Boolean(schedule.completed),
      amount: schedule.amount,
      amountOp: schedule.amountOp,
      paidDates: linked
        .filter(link => link.schedule === schedule.id)
        .map(link => link.date),
    })),
    today,
    end,
  );

  const cards: ReportCard[] = [];
  const unpaidBills: CardBillInput[] = [];
  const dueByMonth = new Map<string, number>();
  let paidOnCards = 0;
  for (const { account, result } of await loadCards(lib)) {
    if (result.status !== 'ok') continue;
    paidOnCards += result.bills
      .filter(bill => bill.referenceMonth === month)
      .reduce((sum, bill) => sum + bill.paid, 0);
    const first = result.bills.findIndex(
      bill => bill.referenceMonth === result.currentMonth,
    );
    const bills = first === -1 ? [] : result.bills.slice(first);
    for (const bill of bills) {
      const due = cardBillDue(bill);
      dueByMonth.set(
        bill.referenceMonth,
        (dueByMonth.get(bill.referenceMonth) ?? 0) + due,
      );
      unpaidBills.push({
        card: account,
        referenceMonth: bill.referenceMonth,
        dueDate: bill.effectiveDueDate,
        status: bill.status,
        due,
      });
    }
    const current = bills[0];
    if (current && (current.total !== 0 || (result.limit.used ?? 0) !== 0)) {
      cards.push({
        name: account,
        referenceMonth: current.referenceMonth,
        dueDate: current.effectiveDueDate,
        status: current.status,
        total: current.total,
        paid: current.paid,
        due: cardBillDue(current),
        limitTotal: result.limit.total,
        limitUsed: result.limit.used,
      });
    }
  }

  const pendingBills = sortPendingBills([
    ...scheduleBills,
    ...pendingCardBills(unpaidBills, today, end),
  ]);
  const paidOnSchedules = linked
    .filter(
      link =>
        billScheduleIds.has(link.schedule) &&
        link.amount < 0 &&
        link.date >= start &&
        link.date <= end,
    )
    .reduce((sum, link) => sum - link.amount, 0);

  const incomeGroups = groups.filter(group => group.is_income);
  const incomeGroupIds = new Set(incomeGroups.map(group => group.id));
  const incomeCategories = new Set(
    categories.filter(c => incomeGroupIds.has(c.group_id)).map(c => c.id),
  );
  const ignoredNames = new Set(
    ignoredCategories.map(name => name.toLocaleLowerCase()),
  );
  const ignoredIds = new Set(
    categories
      .filter(c => ignoredNames.has(c.name.toLocaleLowerCase()))
      .map(c => c.id),
  );

  const { spending, income, totals } = summarizeSpending({
    rows: await spendingRows([month, previousMonth]),
    categories: categories.map(c => ({
      id: c.id,
      name: c.name,
      group: c.group_id,
    })),
    groups: groups.map(group => ({
      id: group.id,
      name: group.name,
      isIncome: Boolean(group.is_income),
    })),
    ignored: ignoredCategories,
    month,
    previousMonth,
  });

  const cashAccounts = new Set(
    balances
      .filter(a => !a.offbudget && a.kind !== 'credit_card')
      .map(a => a.id),
  );
  const allReceipts = await collectReceipts(
    start,
    today,
    cashAccounts,
    incomeCategories,
    ignoredIds,
  );
  const sumOf = (kind: Receipt['kind']) =>
    allReceipts
      .filter(receipt => receipt.kind === kind)
      .reduce((sum, receipt) => sum + receipt.amount, 0);

  const { cash, setAside } = splitCash(
    balances.filter(a => cashAccounts.has(a.id)),
    setAsideAccounts,
  );
  const toPay = pendingBills.reduce((sum, bill) => sum + bill.amount, 0);

  return {
    generatedAt: new Date().toISOString(),
    today,
    month,
    previousMonth,
    totals: {
      ...totals,
      credits: sumOf('credit'),
      uncategorizedInflow: sumOf('uncategorized'),
      toPay,
      paid: paidOnSchedules + paidOnCards,
      overdueCount: pendingBills.filter(bill => bill.status === 'overdue')
        .length,
      cash,
      setAside,
      leftAfterBills: cash - toPay,
    },
    pendingBills,
    cards,
    dueByMonth: [...dueByMonth]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, DUE_MONTHS_SHOWN)
      .map(([dueMonth, amount]): MonthAmount => ({ month: dueMonth, amount })),
    spending,
    income,
    ...limitReceipts(allReceipts, RECEIPTS_SHOWN),
    accounts: describeAccounts(balances, setAsideAccounts),
  };
}
