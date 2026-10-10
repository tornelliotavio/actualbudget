import * as asyncStorage from '#platform/server/asyncStorage';
import * as db from '#server/db';
import { post } from '#server/post';
import { getPrefs } from '#server/prefs';
import { getServer } from '#server/server-config';
import { amountToInteger } from '#shared/util';
import type { IntegerAmount } from '#shared/util';
import type { AccountEntity } from '#types/models';

export type CreditCardBill = {
  id: string;
  dueDate: string;
  totalAmount: IntegerAmount;
  minimumPaymentAmount: IntegerAmount | null;
  paidAmount: IntegerAmount;
};

type PluggyBill = {
  id: string;
  dueDate: string;
  totalAmount: number;
  minimumPaymentAmount: number | null;
  paidAmount: number;
};

/**
 * The card's closed bills (faturas), oldest due date first. Accounts not
 * synced through Pluggy, and Pluggy accounts that aren't credit cards, have
 * none. Failures come back as `{ error }` rather than throwing, because a
 * thrown handler error surfaces in the app as an internal error.
 */
export async function getPluggyAiBills({
  id,
}: {
  id: AccountEntity['id'];
}): Promise<CreditCardBill[] | { error: string }> {
  // DbAccount types account_sync_source without 'pluggyai'.
  const account = await db.first<{
    account_id: string | null;
    account_sync_source: string | null;
  }>(
    'SELECT account_id, account_sync_source FROM accounts WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (account?.account_sync_source !== 'pluggyai' || !account.account_id) {
    return [];
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
  let data: { bills?: PluggyBill[]; error?: string };
  try {
    data = await post(
      serverConfig.PLUGGYAI_SERVER + '/bills',
      { accountId: account.account_id },
      {
        'X-ACTUAL-TOKEN': userToken,
        ...(fileId ? { 'X-Actual-File-Id': fileId } : {}),
      },
      60000,
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  if (data.error || !data.bills) {
    return { error: data.error ?? 'no-bills' };
  }

  return data.bills.map(bill => ({
    id: bill.id,
    dueDate: bill.dueDate,
    totalAmount: amountToInteger(bill.totalAmount),
    minimumPaymentAmount:
      bill.minimumPaymentAmount == null
        ? null
        : amountToInteger(bill.minimumPaymentAmount),
    paidAmount: amountToInteger(bill.paidAmount),
  }));
}
