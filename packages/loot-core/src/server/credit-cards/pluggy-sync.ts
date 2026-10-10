import * as asyncStorage from '#platform/server/asyncStorage';
import { post } from '#server/post';
import { getPrefs } from '#server/prefs';
import { getServer } from '#server/server-config';
import { amountToInteger } from '#shared/util';

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

function cents(value: number | null): number | null {
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
  const body = { accountId: card.providerAccountId };

  let bills: BillsResponse;
  let account: AccountResponse;
  try {
    bills = await post(
      serverConfig.PLUGGYAI_SERVER + '/bills',
      body,
      headers,
      60000,
    );
    account = await post(
      serverConfig.PLUGGYAI_SERVER + '/credit-card-account',
      body,
      headers,
      60000,
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (bills.error) {
    return { error: bills.error };
  }
  if (account.error) {
    return { error: account.error };
  }

  return applyPluggyCardSnapshot({
    cardId,
    bills: (bills.bills ?? []).map(bill => ({
      id: bill.id,
      dueDate: bill.dueDate,
      totalAmount: bill.totalAmount,
      minimumPaymentAmount: bill.minimumPaymentAmount,
      allowsInstallments: bill.allowsInstallments ?? null,
      currency: bill.currency ?? null,
    })),
    credit: account.creditData ?? null,
  });
}
