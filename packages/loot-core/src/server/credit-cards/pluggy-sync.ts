import * as asyncStorage from '#platform/server/asyncStorage';
import * as db from '#server/db';
import { post } from '#server/post';
import { getPrefs } from '#server/prefs';
import { getServer } from '#server/server-config';
import { amountToInteger } from '#shared/util';
import type { IntegerAmount } from '#shared/util';

import { getCreditCardRow, updateCreditCard } from './cards';
import {
  addCalendarMonths,
  billId,
  importRecordId,
  upcomingCycles,
} from './engine';
import type { Cycle, CycleConfig } from './engine';
import { upsertImportRecord, upsertStoredBill } from './records';
import type { StoredBill } from './records';

export type PluggyBillSnapshot = {
  id: string;
  dueDate: string;
  totalAmount: number | null;
  minimumPaymentAmount: number | null;
  allowsInstallments: boolean | null;
  currency: string | null;
};

export type PluggyCreditSnapshot = {
  creditLimit: number | null;
  availableCreditLimit: number | null;
  balanceCloseDate: string | null;
  balanceDueDate: string | null;
  brand: string | null;
  status: string | null;
  holderType: string | null;
};

type HandlerError = { error: string };

export type AccountPreview = {
  linked: boolean;
  providerAccountId: string | null;
  closingDay: number | null;
  dueDay: number | null;
  creditLimit: IntegerAmount | null;
  availableLimit: IntegerAmount | null;
  brand: string | null;
};

export function dayFromBankDate(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return null;
  }
  const day = Number(value.slice(8, 10));
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return null;
  }
  return day;
}

function cents(value: number | null): IntegerAmount | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return amountToInteger(value);
}

function cycleForMonth(
  referenceMonth: string,
  config: CycleConfig,
): Cycle | null {
  if (!/^\d{4}-\d{2}$/.test(referenceMonth)) {
    return null;
  }
  const from = addCalendarMonths(`${referenceMonth}-01`, -2);
  return (
    upcomingCycles(from, 8, config).find(
      cycle => cycle.referenceMonth === referenceMonth,
    ) ?? null
  );
}

/**
 * Store bank bill totals and limits. Re-running with the same provider ids
 * updates the same rows. Transactions are never inserted here.
 */
export async function applyPluggyCardSnapshot(input: {
  cardId: string;
  bills: PluggyBillSnapshot[];
  credit: PluggyCreditSnapshot | null;
}): Promise<{ bills: number; limitsUpdated: boolean } | HandlerError> {
  const card = await getCreditCardRow(input.cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  const config: CycleConfig = {
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    closingDayPolicy: card.closingDayPolicy,
  };
  const now = new Date(Date.now()).toISOString();
  let stored = 0;
  for (const bill of input.bills) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bill.dueDate)) {
      continue;
    }
    const referenceMonth = bill.dueDate.slice(0, 7);
    const cycle = cycleForMonth(referenceMonth, config);
    const row: StoredBill = {
      id: billId(card.id, referenceMonth),
      cardId: card.id,
      referenceMonth,
      cycleStart: cycle?.cycleStart ?? null,
      cycleEnd: cycle?.cycleEnd ?? null,
      closingDate: cycle?.closingDate ?? null,
      dueDate: bill.dueDate,
      confirmedTotal: cents(bill.totalAmount),
      minimumPayment: cents(bill.minimumPaymentAmount),
      source: 'pluggyai',
      providerBillId: bill.id,
      lastConfirmedAt: now,
      cancelled: false,
    };
    await upsertStoredBill(row);
    await upsertImportRecord({
      id: importRecordId('pluggyai', 'bill', bill.id),
      provider: 'pluggyai',
      entityType: 'bill',
      externalId: bill.id,
      fingerprint: importRecordId('pluggyai', 'bill', bill.id),
      localEntityId: row.id,
      firstSeenAt: now,
      lastSeenAt: now,
      payloadHash: null,
    });
    stored += 1;
  }

  const creditLimit = cents(input.credit?.creditLimit ?? null);
  const availableLimit = cents(input.credit?.availableCreditLimit ?? null);
  let limitsUpdated = false;
  if (creditLimit != null || availableLimit != null) {
    const updated = await updateCreditCard(card.id, {
      ...(creditLimit != null
        ? { creditLimit, creditLimitSource: 'bank' as const }
        : {}),
      ...(availableLimit != null
        ? { availableLimit, availableLimitSource: 'bank' as const }
        : {}),
    });
    if ('error' in updated) {
      return updated;
    }
    limitsUpdated = true;
    if (input.credit) {
      await upsertImportRecord({
        id: importRecordId('pluggyai', 'limits', card.id),
        provider: 'pluggyai',
        entityType: 'limits',
        externalId: card.id,
        fingerprint: importRecordId('pluggyai', 'limits', card.id),
        localEntityId: card.id,
        firstSeenAt: now,
        lastSeenAt: now,
        payloadHash: null,
      });
    }
  }

  return { bills: stored, limitsUpdated };
}

type BillsResponse = {
  bills?: Array<{
    id: string;
    dueDate: string;
    totalAmount: number | null;
    minimumPaymentAmount: number | null;
    allowsInstallments?: boolean | null;
    currency?: string | null;
  }>;
  error?: string;
};

type AccountResponse = {
  creditData?: PluggyCreditSnapshot | null;
  error?: string;
};

async function pluggyRequest<T extends { error?: string }>(
  path: string,
  providerAccountId: string,
): Promise<T | HandlerError> {
  const userToken = await asyncStorage.getItem('user-token');
  if (!userToken) {
    return { error: 'unauthorized' };
  }
  const serverConfig = getServer();
  if (!serverConfig) {
    return { error: 'no-server' };
  }
  const fileId = getPrefs()?.cloudFileId;
  const headers = {
    'X-ACTUAL-TOKEN': userToken,
    ...(fileId ? { 'X-Actual-File-Id': fileId } : {}),
  };
  try {
    return (await post(
      serverConfig.PLUGGYAI_SERVER + path,
      { accountId: providerAccountId },
      headers,
      60000,
    )) as T;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function requestError(value: { error?: string }): string | null {
  if (typeof value.error === 'string' && value.error !== '') {
    return value.error;
  }
  return null;
}

export async function previewPluggyAccount({
  accountId,
}: {
  accountId: string;
}): Promise<AccountPreview | HandlerError> {
  const account = await db.first<{
    account_id: string | null;
    account_sync_source: string | null;
  }>(
    'SELECT account_id, account_sync_source FROM accounts WHERE id = ? AND tombstone = 0',
    [accountId],
  );
  if (account?.account_sync_source !== 'pluggyai' || !account.account_id) {
    return {
      linked: false,
      providerAccountId: null,
      closingDay: null,
      dueDay: null,
      creditLimit: null,
      availableLimit: null,
      brand: null,
    };
  }

  const response = await pluggyRequest<AccountResponse>(
    '/credit-card-account',
    account.account_id,
  );
  const failure = requestError(response);
  if (failure) {
    return { error: failure };
  }
  const credit = (response as AccountResponse).creditData ?? null;
  return {
    linked: true,
    providerAccountId: account.account_id,
    closingDay: dayFromBankDate(credit?.balanceCloseDate ?? null),
    dueDay: dayFromBankDate(credit?.balanceDueDate ?? null),
    creditLimit: cents(credit?.creditLimit ?? null),
    availableLimit: cents(credit?.availableCreditLimit ?? null),
    brand: credit?.brand ?? null,
  };
}

export async function syncPluggyCard(
  cardId: string,
): Promise<{ bills: number; limitsUpdated: boolean } | HandlerError> {
  const card = await getCreditCardRow(cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  if (card.provider !== 'pluggyai' || !card.providerAccountId) {
    return { error: 'not-linked' };
  }

  const bills = await pluggyRequest<BillsResponse>(
    '/bills',
    card.providerAccountId,
  );
  const billsError = requestError(bills);
  if (billsError) {
    return { error: billsError };
  }
  const account = await pluggyRequest<AccountResponse>(
    '/credit-card-account',
    card.providerAccountId,
  );
  const accountError = requestError(account);
  if (accountError) {
    return { error: accountError };
  }
  const billData = bills as BillsResponse;
  const accountData = account as AccountResponse;

  return applyPluggyCardSnapshot({
    cardId,
    bills: (billData.bills ?? []).map(bill => ({
      id: bill.id,
      dueDate: bill.dueDate,
      totalAmount: bill.totalAmount,
      minimumPaymentAmount: bill.minimumPaymentAmount,
      allowsInstallments: bill.allowsInstallments ?? null,
      currency: bill.currency ?? null,
    })),
    credit: accountData.creditData ?? null,
  });
}
