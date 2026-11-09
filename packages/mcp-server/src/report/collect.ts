import * as api from '@actual-app/api';

import type { Lib } from '#budget';
import { cardBillDue, loadCards } from '#tools/card-bills';
import { between } from '#tools/format';
import { loadLookups } from '#tools/lookups';
import type { Lookups } from '#tools/lookups';
import { loadAccountBalances } from '#tools/overview';
import { linkedTransactions } from '#tools/schedules';

import {
  billReminders,
  groupAmounts,
  limitReceipts,
  partOf,
  pendingCardBills,
  pendingSchedules,
  receiptLabel,
  shareOf,
  sortPendingBills,
  splitCash,
  spreadOver,
  summarizeSpending,
} from './summarize';
import type { CardBillInput, SpendingRow } from './summarize';
import type {
  BillItem,
  MonthAmount,
  Receipt,
  ReportAccount,
  ReportCard,
  ReportData,
  ReportShare,
} from './types';

const RECEIPTS_SHOWN = 14;
const DUE_MONTHS_SHOWN = 3;

export type CollectOptions = {
  today: string;
  /** Categories that only move money around, kept out of the totals. */
  ignoredCategories: readonly string[];
  /** Accounts whose money isn't meant for this month's bills. */
  setAsideAccounts: readonly string[];
  /** Bills split with someone else; only the owner's part counts. */
  shares: readonly ReportShare[];
};

type CategoryLine = { category: string | null; amount: number };

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
 * By budget date with projected installments included, mirroring
 * `budgetSpendingByMonthQuery` in loot-core so the totals match the app's
 * overview. Unlike the overview, money out with no category counts too;
 * money in without one is left out so it can't hide that spending.
 */
function spendingFilter(month: string) {
  const { start, end } = monthBounds(month);
  return [
    { budget_date: { $gte: start } },
    { budget_date: { $lte: end } },
    { 'account.offbudget': false },
    {
      $or: [
        { category: { $ne: null } },
        { $and: [{ transfer_id: null }, { amount: { $lt: 0 } }] },
      ],
    },
  ];
}

async function spendingRows(months: readonly string[]): Promise<SpendingRow[]> {
  const rows: SpendingRow[] = [];
  for (const month of months) {
    const { data } = (await api.aqlQuery(
      api
        .q('transactions')
        .filter({ $and: spendingFilter(month) })
        .options({ splits: 'inline' })
        .groupBy('category')
        .select([{ category: 'category' }, { amount: { $sum: '$amount' } }]),
    )) as { data: { category: string | null; amount: number }[] };
    rows.push(...data.map(row => ({ ...row, month })));
  }
  return rows;
}

/**
 * Rows that take the other people's part back out of the spending: charges
 * on a shared card and payments linked to a shared schedule.
 */
async function sharedSpendingAdjustments(
  months: readonly string[],
  cardShares: ReadonlyMap<string, number>,
  scheduleShares: ReadonlyMap<string, number>,
): Promise<SpendingRow[]> {
  const scope = [
    ...(cardShares.size > 0
      ? [{ account: { $oneof: [...cardShares.keys()] } }]
      : []),
    ...(scheduleShares.size > 0
      ? [{ schedule: { $oneof: [...scheduleShares.keys()] } }]
      : []),
  ];
  if (scope.length === 0) return [];

  const rows: SpendingRow[] = [];
  for (const month of months) {
    const { data } = (await api.aqlQuery(
      api
        .q('transactions')
        .filter({ $and: [...spendingFilter(month), { $or: scope }] })
        .options({ splits: 'inline' })
        .select(['category', 'account', 'schedule', 'amount']),
    )) as {
      data: {
        category: string | null;
        account: string;
        schedule: string | null;
        amount: number;
      }[];
    };
    for (const row of data) {
      const share =
        cardShares.get(row.account) ??
        (row.schedule ? scheduleShares.get(row.schedule) : undefined) ??
        1;
      if (share === 1) continue;
      rows.push({
        month,
        category: row.category,
        amount: partOf(row.amount, share) - row.amount,
      });
    }
  }
  return rows;
}

/** The category of each schedule's latest categorized payment. */
async function lastPaymentCategories(): Promise<Map<string, string>> {
  const { data } = (await api.aqlQuery(
    api
      .q('transactions')
      .filter({ schedule: { $ne: null }, category: { $ne: null } })
      .select(['schedule', 'category', 'date'])
      .options({ splits: 'none' })
      .orderBy({ date: 'desc' }),
  )) as { data: { schedule: string; category: string }[] };
  const categories = new Map<string, string>();
  for (const { schedule, category } of data) {
    if (!categories.has(schedule)) categories.set(schedule, category);
  }
  return categories;
}

type PendingCardBill = {
  name: string;
  accountId: string;
  referenceMonth: string;
  dueDate: string;
  share: number;
  /** The owner's part of what's left to pay. */
  due: number;
};

/**
 * The charges on each bill, owner's part. When they don't add up to what's
 * due, because part was paid already, a last line says so; the category
 * lines spread what's due over the charges instead.
 */
async function cardBillCharges(
  bills: readonly PendingCardBill[],
  lookups: Lookups,
): Promise<{ items: BillItem[]; lines: CategoryLine[] }> {
  const items: BillItem[] = [];
  const lines: CategoryLine[] = [];
  for (const bill of bills) {
    const { data } = (await api.aqlQuery(
      api
        .q('transactions')
        .filter({
          account: bill.accountId,
          card_bill: { $like: `%:${bill.referenceMonth}` },
          transfer_id: null,
          amount: { $ne: 0 },
        })
        .options({ splits: 'inline' })
        .select([
          'date',
          'payee',
          'notes',
          'category',
          'amount',
          'installment_number',
          'installment_count',
        ])
        .orderBy({ date: 'asc' }),
    )) as {
      data: {
        date: string;
        payee: string | null;
        notes: string | null;
        category: string | null;
        amount: number;
        installment_number: number | null;
        installment_count: number | null;
      }[];
    };

    const charges = data.map(row => ({
      row,
      amount: partOf(-row.amount, bill.share),
    }));
    for (const { row, amount } of charges) {
      const installment =
        row.installment_number && row.installment_count
          ? ` ${row.installment_number}/${row.installment_count}`
          : '';
      items.push({
        bill: bill.name,
        dueDate: bill.dueDate,
        date: row.date,
        label: `${receiptLabel(lookups.payeeName(row.payee), row.notes)}${installment}`,
        category: lookups.categoryName(row.category),
        amount,
      });
    }
    const listed = charges.reduce((sum, charge) => sum + charge.amount, 0);
    if (listed !== bill.due) {
      items.push({
        bill: bill.name,
        dueDate: bill.dueDate,
        date: bill.dueDate,
        label:
          listed > bill.due
            ? 'Já pago desta fatura'
            : 'Outros lançamentos da fatura',
        category: null,
        amount: bill.due - listed,
      });
    }

    if (charges.length === 0) {
      lines.push({ category: null, amount: bill.due });
      continue;
    }
    const spread = spreadOver(
      bill.due,
      charges.map(charge => charge.amount),
    );
    charges.forEach(({ row }, index) => {
      lines.push({ category: row.category, amount: spread[index] });
    });
  }
  return { items, lines };
}

async function collectReceipts(
  start: string,
  end: string,
  cashAccounts: ReadonlySet<string>,
  incomeCategories: ReadonlySet<string>,
  ignoredCategories: ReadonlySet<string>,
  lookups: Lookups,
): Promise<Receipt[]> {
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
  { today, ignoredCategories, setAsideAccounts, shares }: CollectOptions,
): Promise<ReportData> {
  const month = today.slice(0, 7);
  const previousMonth = monthBefore(month);
  const { start, end } = monthBounds(month);

  const [schedules, payees, linked, groups, categories, lookups, paidAs] = [
    await api.getSchedules(),
    await api.getPayees(),
    await linkedTransactions(),
    await api.getCategoryGroups(),
    await api.getCategories(),
    await loadLookups(),
    await lastPaymentCategories(),
  ];
  const categoryInputs = categories.map(c => ({
    id: c.id,
    name: c.name,
    group: c.group_id,
  }));
  const groupInputs = groups.map(group => ({
    id: group.id,
    name: group.name,
    isIncome: Boolean(group.is_income),
  }));
  const scheduleShares = new Map(
    schedules
      .map(schedule => [schedule.id, shareOf(schedule.name ?? '', shares)])
      .filter((entry): entry is [string, number] => entry[1] !== 1),
  );
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
      share: scheduleShares.get(schedule.id) ?? 1,
      category: paidAs.get(schedule.id) ?? null,
    })),
    today,
    end,
  );

  const cards: ReportCard[] = [];
  const unpaidBills: CardBillInput[] = [];
  const billsThisMonth: PendingCardBill[] = [];
  const cardShares = new Map<string, number>();
  const dueByMonth = new Map<string, number>();
  let paidOnCards = 0;
  for (const { account, accountId, result } of await loadCards(lib)) {
    if (result.status !== 'ok') continue;
    const share = shareOf(account, shares);
    if (share !== 1) cardShares.set(accountId, share);
    paidOnCards += result.bills
      .filter(bill => bill.referenceMonth === month)
      .reduce((sum, bill) => sum + partOf(bill.paid, share), 0);
    const first = result.bills.findIndex(
      bill => bill.referenceMonth === result.currentMonth,
    );
    const bills = first === -1 ? [] : result.bills.slice(first);
    for (const bill of bills) {
      const due = cardBillDue(bill);
      dueByMonth.set(
        bill.referenceMonth,
        (dueByMonth.get(bill.referenceMonth) ?? 0) + partOf(due, share),
      );
      unpaidBills.push({
        card: account,
        referenceMonth: bill.referenceMonth,
        dueDate: bill.effectiveDueDate,
        status: bill.status,
        due,
        share,
      });
      if (due > 0 && bill.effectiveDueDate <= end) {
        billsThisMonth.push({
          name: `Fatura ${account}`,
          accountId,
          referenceMonth: bill.referenceMonth,
          dueDate: bill.effectiveDueDate,
          share,
          due: partOf(due, share),
        });
      }
    }
    const current = bills[0];
    if (current && (current.total !== 0 || (result.limit.used ?? 0) !== 0)) {
      cards.push({
        name: account,
        referenceMonth: current.referenceMonth,
        dueDate: current.effectiveDueDate,
        status: current.status,
        total: partOf(current.total, share),
        paid: partOf(current.paid, share),
        due: partOf(cardBillDue(current), share),
        share,
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
    .reduce(
      (sum, link) =>
        sum - partOf(link.amount, scheduleShares.get(link.schedule) ?? 1),
      0,
    );

  const charges = await cardBillCharges(billsThisMonth, lookups);
  const toPayByCategory = groupAmounts(
    [
      ...scheduleBills.map(bill => ({
        category: bill.category,
        amount: bill.amount,
      })),
      ...charges.lines,
    ],
    categoryInputs,
    groupInputs,
  );

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

  const months = [month, previousMonth];
  const { spending, income, totals } = summarizeSpending({
    rows: [
      ...(await spendingRows(months)),
      ...(await sharedSpendingAdjustments(months, cardShares, scheduleShares)),
    ],
    categories: categoryInputs,
    groups: groupInputs,
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
    lookups,
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
    reminders: billReminders(pendingBills, today),
    toPayByCategory,
    billItems: charges.items,
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
