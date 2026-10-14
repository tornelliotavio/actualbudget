import type { AccountEntity, TransactionEntity } from '#types/models';

import { createBillCalendar } from './engine/bill-calendar';
import type { BillCalendar } from './engine/bill-calendar';
import type { ClassifyOptions } from './engine/classify';
import { descriptionStem } from './engine/installments';
import type {
  BillSource,
  CardEntry,
  CardEntryKind,
  MonthString,
} from './engine/types';
import {
  parseRawSyncedData,
  providerDate,
  providerFacts,
} from './provider-facts';
import { billOverrides, resolveSchedule } from './schedule';
import type { CardAccountState } from './store';

export function billMonthOf(
  accountId: AccountEntity['id'],
  billId: string | null | undefined,
): MonthString | null {
  const prefix = `${accountId}:`;
  return billId?.startsWith(prefix)
    ? billId.slice(prefix.length, prefix.length + 7)
    : null;
}

function entryDescription(
  transaction: TransactionEntity,
  raw: Record<string, unknown> | null,
): string {
  const fromRaw = raw?.descriptionRaw ?? raw?.description;
  if (typeof fromRaw === 'string' && fromRaw.trim()) {
    return fromRaw;
  }
  return transaction.notes || transaction.imported_payee || '';
}

export function toCardEntry(
  accountId: AccountEntity['id'],
  transaction: TransactionEntity,
): CardEntry {
  const raw = transaction.projected
    ? null
    : parseRawSyncedData(transaction.raw_synced_data);
  return {
    id: transaction.id,
    date: (raw && providerDate(raw)) ?? transaction.date,
    amount: transaction.amount,
    importedId: transaction.imported_id ?? null,
    projected: Boolean(transaction.projected),
    isTransfer: Boolean(transaction.transfer_id),
    description: entryDescription(transaction, raw),
    provider: raw ? providerFacts(raw) : null,
    stored: {
      bill: billMonthOf(accountId, transaction.card_bill),
      billSource: (transaction.card_bill_source as BillSource) ?? null,
      kind: (transaction.card_kind as CardEntryKind) ?? null,
      purchaseId: transaction.card_purchase ?? null,
      installmentNumber: transaction.installment_number ?? null,
      installmentCount: transaction.installment_count ?? null,
    },
  };
}

export function classifyOptions(state: CardAccountState): ClassifyOptions {
  const paymentStems = (state.profile?.payment_patterns ?? '')
    .split(/[\n,;]/)
    .map(pattern => descriptionStem(pattern))
    .filter(Boolean);
  const providerPayments = state.bills.flatMap(
    bill => bill.provider_payments ?? [],
  );
  return {
    paymentStems,
    isProviderPayment: entry =>
      providerPayments.some(
        payment =>
          payment.amount === entry.amount &&
          Math.abs(
            (Date.parse(payment.date) - Date.parse(entry.date)) / 86400000,
          ) <= 3,
      ),
  };
}

export function calendarFor(state: CardAccountState): BillCalendar | null {
  const schedule = resolveSchedule(state.profile, state.bills);
  return schedule
    ? createBillCalendar(schedule, billOverrides(state.bills))
    : null;
}
