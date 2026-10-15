import * as fs from '#platform/server/fs';
import { createApp } from '#server/app';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import { undoable } from '#server/undo';
import type {
  AccountEntity,
  CardPurchaseEntity,
  TransactionEntity,
} from '#types/models';

import { getCardBills } from './bills';
import { billRowId } from './engine/ids';
import type { CardSettingsInput } from './profiles';
import { makeCreditCardAccount, updateCardSettings } from './profiles';
import { reconcileCardAccount } from './reconcile';
import { revertCreditCardAccount } from './revert';
import { importCardStatement, previewCardStatement } from './statements/import';
import type { StatementText } from './statements/types';

export type CreditCardsHandlers = {
  'credit-card-make': typeof makeCard;
  'credit-card-revert': typeof revertCard;
  'credit-card-settings-update': typeof updateSettings;
  'credit-card-bills': typeof getBills;
  'credit-card-reconcile': typeof reconcile;
  'credit-card-bill-update': typeof updateBill;
  'credit-card-transaction-bill': typeof moveTransactionToBill;
  'credit-card-purchase-status': typeof setPurchaseStatus;
  'credit-card-statement-file': typeof readStatementFile;
  'credit-card-statement-preview': typeof previewStatement;
  'credit-card-statement-import': typeof importStatement;
};

export const app = createApp<CreditCardsHandlers>();
app.method('credit-card-make', mutator(undoable(makeCard)));
app.method('credit-card-revert', mutator(undoable(revertCard)));
app.method('credit-card-settings-update', mutator(undoable(updateSettings)));
app.method('credit-card-bills', getBills);
app.method('credit-card-reconcile', mutator(undoable(reconcile)));
app.method('credit-card-bill-update', mutator(undoable(updateBill)));
app.method(
  'credit-card-transaction-bill',
  mutator(undoable(moveTransactionToBill)),
);
app.method('credit-card-purchase-status', mutator(undoable(setPurchaseStatus)));
app.method('credit-card-statement-file', readStatementFile);
app.method('credit-card-statement-preview', previewStatement);
app.method('credit-card-statement-import', mutator(undoable(importStatement)));

async function makeCard({
  accountId,
  ...settings
}: { accountId: AccountEntity['id'] } & CardSettingsInput) {
  await makeCreditCardAccount(accountId, settings);
  return reconcileCardAccount(accountId);
}

async function revertCard({ accountId }: { accountId: AccountEntity['id'] }) {
  await revertCreditCardAccount(accountId);
}

async function updateSettings({
  accountId,
  fields,
}: {
  accountId: AccountEntity['id'];
  fields: Parameters<typeof updateCardSettings>[1];
}) {
  await updateCardSettings(accountId, fields);
  return reconcileCardAccount(accountId);
}

async function getBills({ accountId }: { accountId: AccountEntity['id'] }) {
  return getCardBills(accountId);
}

async function reconcile({ accountId }: { accountId: AccountEntity['id'] }) {
  return reconcileCardAccount(accountId);
}

/** User-stated dates or total of one bill; `null` clears a value. */
async function updateBill({
  accountId,
  referenceMonth,
  fields,
}: {
  accountId: AccountEntity['id'];
  referenceMonth: string;
  fields: {
    closing_date_user?: string | null;
    due_date_user?: string | null;
    total_user?: number | null;
  };
}) {
  const id = billRowId(accountId, referenceMonth);
  const existing = await db.first<{ id: string }>(
    'SELECT id FROM card_bills WHERE id = ?',
    [id],
  );
  if (existing) {
    await db.updateWithSchema('card_bills', {
      id,
      tombstone: false,
      ...fields,
    });
  } else {
    await db.insertWithSchema('card_bills', {
      id,
      account: accountId,
      reference_month: referenceMonth,
      ...fields,
    });
  }
  return reconcileCardAccount(accountId);
}

/** Pins a transaction to a bill, or back to automatic with `null`. */
async function moveTransactionToBill({
  id,
  referenceMonth,
}: {
  id: TransactionEntity['id'];
  referenceMonth: string | null;
}) {
  const row = await db.first<{ acct: string }>(
    'SELECT acct FROM transactions WHERE id = ?',
    [id],
  );
  if (!row) {
    throw new Error('Transaction not found');
  }
  await db.updateTransaction(
    referenceMonth
      ? {
          id,
          card_bill: billRowId(row.acct, referenceMonth),
          card_bill_source: 'user',
        }
      : { id, card_bill_source: null },
  );
  return reconcileCardAccount(row.acct);
}

/** Cancels or restores the projected installments of a purchase. */
async function setPurchaseStatus({
  id,
  status,
}: {
  id: CardPurchaseEntity['id'];
  status: CardPurchaseEntity['status'];
}) {
  const row = await db.first<{ account: string }>(
    'SELECT account FROM card_purchases WHERE id = ?',
    [id],
  );
  if (!row) {
    throw new Error('Purchase not found');
  }
  await db.updateWithSchema('card_purchases', { id, status });
  return reconcileCardAccount(row.account);
}

/**
 * The bytes of a statement the user picked. Its text is extracted on the
 * client, where the PDF library is loaded only when a statement is imported.
 */
async function readStatementFile({ filepath }: { filepath: string }) {
  return new Uint8Array(await fs.readFile(filepath, 'binary'));
}

async function previewStatement({
  accountId,
  text,
}: {
  accountId: AccountEntity['id'];
  text: StatementText;
}) {
  return previewCardStatement(accountId, text);
}

async function importStatement({
  accountId,
  text,
}: {
  accountId: AccountEntity['id'];
  text: StatementText;
}) {
  return importCardStatement(accountId, text);
}
