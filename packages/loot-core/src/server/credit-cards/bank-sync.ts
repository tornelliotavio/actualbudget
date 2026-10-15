import { linkTransfers } from '#server/accounts/transfer-links';
import * as db from '#server/db';
import { addDays, currentDay } from '#shared/months';
import type { AccountEntity } from '#types/models';

import { linkCardPayments } from './payment-links';
import { parseRawSyncedData } from './provider-facts';
import { reconcileCardAccount } from './reconcile';
import { applyCardSnapshot } from './snapshot';
import type { ProviderCardSnapshot } from './snapshot';

/** Days a pending card charge may be missing from the bank before removal. */
const PENDING_GRACE_DAYS = 3;

export type CardSnapshotPayload =
  | ProviderCardSnapshot
  | { error: string }
  | null
  | undefined;

function isSnapshot(
  payload: CardSnapshotPayload,
): payload is ProviderCardSnapshot {
  return payload != null && !('error' in payload);
}

/**
 * Runs before a bank sync imports transactions. A bank account the provider
 * reports as a credit card becomes a card account here, which is how
 * accounts linked before card support learn their kind.
 */
export async function prepareCardImport(
  accountId: AccountEntity['id'],
  snapshot: CardSnapshotPayload,
): Promise<boolean> {
  if (isSnapshot(snapshot)) {
    await applyCardSnapshot(accountId, snapshot);
  }
  const account = await db.first<{ kind: string | null }>(
    'SELECT kind FROM accounts WHERE id = ?',
    [accountId],
  );
  return account?.kind === 'credit_card';
}

function wasPendingAtTheBank(rawSyncedData: string | null) {
  const raw = parseRawSyncedData(rawSyncedData);
  return raw != null && (raw.booked === false || raw.status === 'PENDING');
}

/**
 * A pending card charge the bank stopped returning was cancelled (an
 * authorization that never posted) or replaced under a new id. It is
 * removed once it has been missing for a few days. Only charges the bank
 * itself last sent as pending qualify; posted charges and transfers are
 * never removed.
 */
async function removeVanishedPending(
  accountId: AccountEntity['id'],
  downloadedIds: Set<string>,
  windowStart: string,
  today: string,
) {
  if (downloadedIds.size === 0) {
    return;
  }
  const rows = (
    await db.all<{
      id: string;
      financial_id: string;
      bank_sync_missing_since: number | null;
      raw_synced_data: string | null;
    }>(
      `SELECT id, financial_id, bank_sync_missing_since, raw_synced_data
       FROM transactions
       WHERE acct = ? AND tombstone = 0 AND isParent = 0 AND isChild = 0
         AND transferred_id IS NULL
         AND IFNULL(projected, 0) = 0 AND financial_id IS NOT NULL
         AND date >= ?`,
      [accountId, db.toDateRepr(windowStart)],
    )
  ).filter(row => wasPendingAtTheBank(row.raw_synced_data));
  const graceLimit = db.toDateRepr(addDays(today, -PENDING_GRACE_DAYS));
  for (const row of rows) {
    if (downloadedIds.has(row.financial_id)) {
      if (row.bank_sync_missing_since != null) {
        await db.updateTransaction({
          id: row.id,
          bank_sync_missing_since: null,
        });
      }
      continue;
    }
    if (row.bank_sync_missing_since == null) {
      await db.updateTransaction({
        id: row.id,
        bank_sync_missing_since: today,
      });
    } else if (row.bank_sync_missing_since <= graceLimit) {
      await db.deleteTransaction({ id: row.id });
    }
  }
}

/** Runs after a bank sync imported a card account's transactions. */
export async function finishCardImport(
  accountId: AccountEntity['id'],
  downloadedIds: Set<string>,
  windowStart: string,
  { today = currentDay() }: { today?: string } = {},
) {
  await removeVanishedPending(accountId, downloadedIds, windowStart, today);
  return reconcileCardAccount(accountId, { today });
}

/**
 * Runs after any bank sync: a checking account can import a bill payment or
 * one side of a transfer between the user's accounts.
 */
export async function finishAnyImport({
  today = currentDay(),
}: { today?: string } = {}) {
  await linkCardPayments({ today });
  await linkTransfers({ today });
}
