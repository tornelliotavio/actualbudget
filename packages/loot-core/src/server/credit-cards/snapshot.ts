import * as db from '#server/db';
import { addMonths } from '#shared/months';
import { amountToInteger } from '#shared/util';
import type {
  AccountEntity,
  CardBillEntity,
  CardBillPayment,
  CardProfileEntity,
} from '#types/models';

import { createBillCalendar } from './engine/bill-calendar';
import { billRowId } from './engine/ids';
import { makeCreditCardAccount } from './profiles';
import { billOverrides, resolveSchedule } from './schedule';

/** Card data the sync server sends next to the transactions. */
export type ProviderCardSnapshot = {
  connector: 'open_finance' | 'direct';
  creditLimit: number | null;
  availableCreditLimit: number | null;
  balanceCloseDate: string | null;
  balanceDueDate: string | null;
  minimumPayment: number | null;
  brand: string | null;
  status: string | null;
  holderType: string | null;
  bills: ProviderBillSnapshot[];
};

export type ProviderBillSnapshot = {
  id: string;
  dueDate: string | null;
  closingDate: string | null;
  totalAmount: number;
  minimumPaymentAmount: number | null;
  financeCharges: Array<{ amount: number | null }>;
  payments: Array<{
    id: string | null;
    date: string | null;
    amount: number | null;
  }>;
};

function cents(value: number | null | undefined): number | null {
  return value == null ? null : amountToInteger(value);
}

function dayOf(date: string | null): number | null {
  return date ? Number(date.slice(8, 10)) : null;
}

function changed(
  current: Record<string, unknown> | null,
  desired: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(desired).filter(([key, value]) => {
      const before = current?.[key] ?? null;
      return JSON.stringify(before) !== JSON.stringify(value ?? null);
    }),
  );
}

async function loadProfile(accountId: AccountEntity['id']) {
  return (await db.selectFirstWithSchema(
    'card_profiles',
    'SELECT * FROM card_profiles WHERE id = ?',
    [accountId],
  )) as CardProfileEntity | null;
}

async function loadBills(accountId: AccountEntity['id']) {
  return (await db.selectWithSchema(
    'card_bills',
    'SELECT * FROM card_bills WHERE account = ? AND tombstone = 0',
    [accountId],
  )) as CardBillEntity[];
}

/**
 * Reference month of a bank bill: the month whose nominal due date is
 * closest to the bank's due date. Banks move due dates past weekends, which
 * can push a bill due on the 31st into the next month.
 */
function referenceMonthFor(
  bill: ProviderBillSnapshot,
  nominalDueDate: ((month: string) => string) | null,
): string | null {
  if (!bill.dueDate) {
    return null;
  }
  const dueMonth = bill.dueDate.slice(0, 7);
  if (!nominalDueDate) {
    return dueMonth;
  }
  const distance = (month: string) =>
    Math.abs(Date.parse(nominalDueDate(month)) - Date.parse(bill.dueDate!));
  return [addMonths(dueMonth, -1), dueMonth, addMonths(dueMonth, 1)].reduce(
    (best, month) => (distance(month) < distance(best) ? month : best),
  );
}

/**
 * Stores what the bank reported about a card: billing days, limits and
 * bills. User overrides live in other columns and are never touched.
 */
export async function applyCardSnapshot(
  accountId: AccountEntity['id'],
  snapshot: ProviderCardSnapshot,
): Promise<void> {
  await makeCreditCardAccount(accountId);

  const latestBill = [...snapshot.bills]
    .filter(bill => bill.dueDate)
    .sort((a, b) => b.dueDate!.localeCompare(a.dueDate!))[0];

  const profile = await loadProfile(accountId);
  const profileChanges = changed(profile as Record<string, unknown> | null, {
    closing_day_provider:
      dayOf(snapshot.balanceCloseDate) ??
      dayOf(latestBill?.closingDate ?? null) ??
      profile?.closing_day_provider ??
      null,
    due_day_provider:
      dayOf(snapshot.balanceDueDate) ??
      dayOf(latestBill?.dueDate ?? null) ??
      profile?.due_day_provider ??
      null,
    connector: snapshot.connector,
    brand: snapshot.brand,
    holder_type: snapshot.holderType,
    card_status: snapshot.status,
  });
  if (Object.keys(profileChanges).length > 0) {
    await db.updateWithSchema('card_profiles', {
      id: accountId,
      ...profileChanges,
    });
  }

  const account = await db.first<{
    balance_limit: number | null;
    balance_available: number | null;
  }>('SELECT balance_limit, balance_available FROM accounts WHERE id = ?', [
    accountId,
  ]);
  const limits = changed(account, {
    balance_limit: cents(snapshot.creditLimit) ?? account?.balance_limit,
    balance_available:
      cents(snapshot.availableCreditLimit) ?? account?.balance_available,
  });
  if (Object.keys(limits).length > 0) {
    await db.update('accounts', { id: accountId, ...limits });
  }

  const bills = await loadBills(accountId);
  const schedule = resolveSchedule(await loadProfile(accountId), bills);
  const calendar = schedule
    ? createBillCalendar(schedule, billOverrides(bills))
    : null;
  const nominalDueDate = calendar
    ? (month: string) => calendar.period(month).budgetDate
    : null;

  const byId = new Map(bills.map(bill => [bill.id, bill]));
  const taken = new Map<string, string>();

  const ordered = [...snapshot.bills].sort((a, b) =>
    (a.dueDate ?? '').localeCompare(b.dueDate ?? ''),
  );
  for (const bill of ordered) {
    let month = referenceMonthFor(bill, nominalDueDate);
    if (!month) {
      continue;
    }
    // Two bank bills in one month: the bank changed the cycle. The later
    // one moves to the following month rather than overwriting the first.
    while (taken.has(month) && taken.get(month) !== bill.id) {
      month = addMonths(month, 1);
    }
    taken.set(month, bill.id);

    const id = billRowId(accountId, month);
    const payments: CardBillPayment[] = bill.payments
      .filter(payment => payment.date && payment.amount != null)
      .map(payment => ({
        id: payment.id,
        date: payment.date!,
        amount: amountToInteger(payment.amount!),
      }));
    const facts = {
      provider_bill_id: bill.id,
      due_date_provider: bill.dueDate,
      closing_date_provider: bill.closingDate,
      provider_total: cents(bill.totalAmount),
      provider_minimum: cents(bill.minimumPaymentAmount),
      provider_finance_charges: bill.financeCharges.reduce(
        (sum, charge) => sum + (cents(charge.amount) ?? 0),
        0,
      ),
      provider_payments: payments,
    };
    const current = byId.get(id);
    if (!current) {
      await db.insertWithSchema('card_bills', {
        id,
        account: accountId,
        reference_month: month,
        ...facts,
      });
      continue;
    }
    const changes = changed(current as unknown as Record<string, unknown>, {
      ...facts,
      tombstone: false,
    });
    if (Object.keys(changes).length > 0) {
      await db.updateWithSchema('card_bills', { id, ...changes });
    }
  }
}
