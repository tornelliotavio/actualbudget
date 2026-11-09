import { addDays } from '#tools/format';
import { amountRange, scheduleStatus } from '#tools/schedules';

import { daysUntil } from './format';
import type {
  AmountGroup,
  AmountLine,
  BillReminders,
  IncomeLine,
  PendingBill,
  Receipt,
  ReportBillStatus,
  ReportShare,
  SpendingGroup,
  SpendingLine,
} from './types';

const SOON_DAYS = 7;

export type ScheduleInput = {
  name: string;
  nextDate: string;
  completed: boolean;
  amount: unknown;
  amountOp: string | undefined;
  paidDates: string[];
  share: number;
  category: string | null;
};

export type CardBillInput = {
  card: string;
  referenceMonth: string;
  dueDate: string;
  status: string;
  due: number;
  share: number;
};

/** The owner's part of whatever `name` is: a schedule or a card account. */
export function shareOf(name: string, shares: readonly ReportShare[]) {
  const lower = name.toLocaleLowerCase('pt-BR');
  const rule = shares.find(({ match }) =>
    lower.includes(match.toLocaleLowerCase('pt-BR')),
  );
  return rule?.share ?? 1;
}

/** Rounds half away from zero, so a debit and its refund halve alike. */
export function partOf(cents: number, share: number) {
  if (share === 1) return cents;
  return Math.sign(cents) * Math.round(Math.abs(cents) * share);
}

/**
 * Scales `amounts` so they add up to exactly `total`, the rounding left on
 * the largest. A bill already partly paid spreads what's left over its
 * charges in proportion.
 */
export function spreadOver(total: number, amounts: readonly number[]) {
  const sum = amounts.reduce((acc, amount) => acc + amount, 0);
  if (sum === total || amounts.length === 0) return [...amounts];
  if (sum === 0) return amounts.map((_, index) => (index === 0 ? total : 0));
  const scaled = amounts.map(amount => Math.round((amount * total) / sum));
  const largest = scaled.reduce(
    (best, amount, index) =>
      Math.abs(amount) > Math.abs(scaled[best]) ? index : best,
    0,
  );
  scaled[largest] += total - scaled.reduce((acc, amount) => acc + amount, 0);
  return scaled;
}

export type CategoryInput = { id: string; name: string; group: string };
export type GroupInput = { id: string; name: string; isIncome: boolean };

export type SpendingRow = {
  month: string;
  category: string | null;
  amount: number;
};

export type SpendingSummary = {
  spending: SpendingGroup[];
  income: IncomeLine[];
  totals: {
    spent: number;
    previousSpent: number;
    received: number;
    previousReceived: number;
  };
};

function middle(amount: unknown, op: string | undefined) {
  const { min, max } = amountRange(amount, op);
  return op === 'isbetween' ? Math.round((min + max) / 2) : Number(amount ?? 0);
}

function statusByDate(dueDate: string, today: string): ReportBillStatus {
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'due';
  return daysUntil(today, dueDate) <= SOON_DAYS ? 'upcoming' : 'scheduled';
}

/** Recurring bills unpaid up to the end of the month, older misses included. */
export function pendingSchedules(
  schedules: readonly ScheduleInput[],
  today: string,
  monthEnd: string,
): PendingBill[] {
  return schedules.flatMap(schedule => {
    const amount = middle(schedule.amount, schedule.amountOp);
    const status = scheduleStatus(
      schedule.nextDate,
      schedule.completed,
      schedule.paidDates,
      today,
    );
    if (
      amount >= 0 ||
      schedule.nextDate > monthEnd ||
      status === 'paid' ||
      status === 'completed'
    ) {
      return [];
    }
    return [
      {
        name: schedule.name,
        dueDate: schedule.nextDate,
        amount: partOf(-amount, schedule.share),
        kind: 'schedule' as const,
        isEstimate: schedule.amountOp !== 'is',
        status: statusByDate(schedule.nextDate, today),
        share: schedule.share,
        category: schedule.category,
      },
    ];
  });
}

/** Card bills unpaid up to the end of the month. */
export function pendingCardBills(
  bills: readonly CardBillInput[],
  today: string,
  monthEnd: string,
): PendingBill[] {
  return bills
    .filter(bill => bill.due > 0 && bill.dueDate <= monthEnd)
    .map(bill => {
      const byDate = statusByDate(bill.dueDate, today);
      const isOpen = bill.status === 'open' || bill.status === 'upcoming';
      return {
        name: `Fatura ${bill.card}`,
        dueDate: bill.dueDate,
        amount: partOf(bill.due, bill.share),
        kind: 'card' as const,
        isEstimate: false,
        status: isOpen && byDate !== 'overdue' ? 'open' : byDate,
        share: bill.share,
        category: null,
      };
    });
}

export function sortPendingBills(bills: readonly PendingBill[]) {
  return [...bills].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || b.amount - a.amount,
  );
}

/** By due date, so a card bill still open counts as due on its day too. */
export function billReminders(
  bills: readonly PendingBill[],
  today: string,
): BillReminders {
  const tomorrow = addDays(today, 1);
  return {
    overdue: bills.filter(bill => bill.dueDate < today),
    today: bills.filter(bill => bill.dueDate === today),
    tomorrow: bills.filter(bill => bill.dueDate === tomorrow),
  };
}

/**
 * Amounts by category id, grouped like the budget, largest first. What has
 * no category, or one that's gone, lands in "Sem categoria".
 */
export function groupAmounts(
  lines: readonly { category: string | null; amount: number }[],
  categories: readonly CategoryInput[],
  groups: readonly GroupInput[],
): AmountGroup[] {
  const byId = new Map(categories.map(category => [category.id, category]));
  const byCategory = new Map<string | null, number>();
  for (const { category, amount } of lines) {
    const known = category && byId.has(category) ? category : null;
    byCategory.set(known, (byCategory.get(known) ?? 0) + amount);
  }
  const result: AmountGroup[] = groups.flatMap(group => {
    const shown: AmountLine[] = categories
      .filter(category => category.group === group.id)
      .map(category => ({
        name: category.name,
        total: byCategory.get(category.id) ?? 0,
      }))
      .filter(line => line.total !== 0)
      .sort(byLargest);
    if (shown.length === 0) return [];
    return [
      {
        name: group.name,
        total: shown.reduce((sum, line) => sum + line.total, 0),
        categories: shown,
      },
    ];
  });
  const unknown = byCategory.get(null) ?? 0;
  if (unknown !== 0) {
    result.push({ name: 'Sem categoria', total: unknown, categories: [] });
  }
  return result.sort(byLargest);
}

function byLargest<T extends { total: number }>(a: T, b: T) {
  return b.total - a.total;
}

function sumLines(name: string, lines: readonly SpendingLine[]): SpendingLine {
  return {
    name,
    total: lines.reduce((sum, l) => sum + l.total, 0),
    previous: lines.reduce((sum, l) => sum + l.previous, 0),
  };
}

/**
 * Spending per group and category in `month`, income apart, with a line for
 * what has no category yet. `ignored` categories count as neither; money in
 * without a category isn't spending.
 */
export function summarizeSpending({
  rows,
  categories,
  groups,
  ignored,
  month,
  previousMonth,
}: {
  rows: readonly SpendingRow[];
  categories: readonly CategoryInput[];
  groups: readonly GroupInput[];
  ignored: readonly string[];
  month: string;
  previousMonth: string;
}): SpendingSummary {
  const amount = (category: string | null, wanted: string) =>
    rows
      .filter(row => row.category === category && row.month === wanted)
      .reduce((sum, row) => sum + row.amount, 0);
  const incomeLine = (category: CategoryInput): IncomeLine => ({
    name: category.name,
    total: amount(category.id, month),
    previous: amount(category.id, previousMonth),
  });
  // Subtracting from zero keeps an empty category at 0 rather than -0.
  const spendingLine = (category: CategoryInput): SpendingLine => ({
    name: category.name,
    total: 0 - amount(category.id, month),
    previous: 0 - amount(category.id, previousMonth),
  });
  const isIncome = new Set(groups.filter(g => g.isIncome).map(g => g.id));
  const skipped = new Set(ignored.map(name => name.toLocaleLowerCase()));

  const counted = categories.filter(
    c => !skipped.has(c.name.toLocaleLowerCase()),
  );
  const expenses = counted.filter(c => !isIncome.has(c.group));
  const incomes = counted.filter(c => isIncome.has(c.group)).map(incomeLine);

  const spending = groups
    .filter(group => !group.isIncome)
    .flatMap((group): SpendingGroup[] => {
      const lines = expenses
        .filter(category => category.group === group.id)
        .map(spendingLine);
      const shown = lines.filter(l => l.total !== 0).sort(byLargest);
      if (shown.length === 0) return [];
      return [{ ...sumLines(group.name, lines), categories: shown }];
    });

  const unknown = {
    name: 'Sem categoria',
    total: 0 - Math.min(amount(null, month), 0),
    previous: 0 - Math.min(amount(null, previousMonth), 0),
  };
  if (unknown.total > 0) {
    spending.push({ ...unknown, categories: [] });
  }

  const spent = sumLines('', [...expenses.map(spendingLine), unknown]);
  const received = sumLines('', incomes);
  return {
    spending: spending.sort(byLargest),
    income: incomes.filter(l => l.total !== 0).sort(byLargest),
    totals: {
      spent: spent.total,
      previousSpent: spent.previous,
      received: received.total,
      previousReceived: received.previous,
    },
  };
}

/** Splits money in hand into what can pay bills and what is kept apart. */
export function splitCash(
  accounts: readonly { name: string; balance: number }[],
  setAsideAccounts: readonly string[],
) {
  const setAside = new Set(setAsideAccounts.map(n => n.toLocaleLowerCase()));
  const isSetAside = (name: string) => setAside.has(name.toLocaleLowerCase());
  const total = (wanted: boolean) =>
    accounts
      .filter(account => isSetAside(account.name) === wanted)
      .reduce((sum, account) => sum + account.balance, 0);
  return { cash: total(false), setAside: total(true) };
}

/** Pix keys and tax ids make poor names; the bank description has the person. */
export function receiptLabel(payee: string | null, notes: string | null) {
  if (payee && !/^[\d./-]+$/.test(payee)) return payee;
  return (
    (notes ?? '')
      .replace(/^pix recebido\s*-?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Sem descrição'
  );
}

export function limitReceipts(receipts: readonly Receipt[], limit: number) {
  const sorted = [...receipts].sort(
    (a, b) => b.amount - a.amount || b.date.localeCompare(a.date),
  );
  const rest = sorted.slice(limit);
  return {
    receipts: sorted.slice(0, limit),
    otherReceipts: {
      count: rest.length,
      amount: rest.reduce((sum, receipt) => sum + receipt.amount, 0),
    },
  };
}
