import { reconcileTransactions } from '#server/accounts/sync';
import { finishAnyImport } from '#server/credit-cards/bank-sync';
import { billMonthOf } from '#server/credit-cards/card-entries';
import { reconcileCardAccount } from '#server/credit-cards/reconcile';
import { applyCardSnapshot } from '#server/credit-cards/snapshot';
import * as db from '#server/db';
import { addDays, differenceInCalendarDays } from '#shared/months';
import type { AccountEntity } from '#types/models';

import { postingDate, toCardSnapshot, toStatementRows } from './rows';
import type { StatementRow } from './rows';
import type { CardStatement, StatementEntry, StatementText } from './types';
import { StatementParseError } from './types';

import { findStatementParser, statementParsers } from './index';

/** How far a manual entry's date may be from the statement's and still be it. */
const REPLACE_WINDOW_DAYS = 45;
/** The window bank sync uses to match a payment already on the card. */
const MATCH_WINDOW_DAYS = 7;

export type StatementEntryStatus =
  /** Already imported from this statement. */
  | 'imported'
  /** Takes the place of an entry typed in by hand. */
  | 'replaces'
  /** A payment already on the card, from the account that paid it. */
  | 'on-card'
  | 'new';

export type StatementPreviewEntry = StatementEntry & {
  postingDate: string;
  status: StatementEntryStatus;
  replaces: { id: string; date: string; notes: string | null } | null;
};

export type StatementPreview = {
  issuer: string;
  issuerName: string;
  statement: Omit<CardStatement, 'entries'>;
  entries: StatementPreviewEntry[];
};

export type StatementError = 'not-a-card' | 'unknown-issuer' | 'unreadable';

export type StatementFailure = {
  error: StatementError;
  message?: string;
  /** Issuers whose statements can be read, when the issuer was unknown. */
  supported?: string[];
};

export type StatementPreviewResult =
  | { preview: StatementPreview }
  | StatementFailure;

export type StatementImportResult =
  | { added: number; updated: number; replaced: number }
  | StatementFailure;

type ManualRow = {
  id: string;
  date: number;
  amount: number;
  category: string | null;
  notes: string | null;
  card_bill: string | null;
};

type ImportPlan = {
  statement: CardStatement;
  issuerName: string;
  rows: StatementRow[];
  entries: StatementPreviewEntry[];
  replaced: Map<string, ManualRow>;
};

function readStatement(
  text: StatementText,
): { statement: CardStatement; issuerName: string } | StatementFailure {
  const parser = findStatementParser(text);
  if (!parser) {
    return {
      error: 'unknown-issuer',
      supported: statementParsers.map(known => known.name),
    };
  }
  try {
    return { statement: parser.parse(text), issuerName: parser.name };
  } catch (error) {
    if (error instanceof StatementParseError) {
      return { error: 'unreadable', message: error.message };
    }
    throw error;
  }
}

async function isCard(accountId: AccountEntity['id']) {
  const account = await db.first<{ kind: string | null }>(
    'SELECT kind FROM accounts WHERE id = ? AND tombstone = 0',
    [accountId],
  );
  return account?.kind === 'credit_card';
}

/** Entries typed in by hand: no bank id, not a transfer, not projected. */
async function loadManualRows(accountId: AccountEntity['id']) {
  return db.all<ManualRow>(
    `SELECT id, date, amount, category, notes, card_bill FROM transactions
     WHERE acct = ? AND tombstone = 0 AND isParent = 0 AND isChild = 0
       AND financial_id IS NULL AND transferred_id IS NULL
       AND IFNULL(projected, 0) = 0 AND IFNULL(starting_balance_flag, 0) = 0`,
    [accountId],
  );
}

async function loadImportedIds(
  accountId: AccountEntity['id'],
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }
  const rows = await db.all<{ financial_id: string }>(
    `SELECT financial_id FROM transactions
     WHERE acct = ? AND tombstone = 0
       AND financial_id IN (${ids.map(() => '?').join(', ')})`,
    [accountId, ...ids],
  );
  return new Set(rows.map(row => row.financial_id));
}

async function hasPaymentOnCard(
  accountId: AccountEntity['id'],
  amount: number,
  date: string,
) {
  const row = await db.first<{ id: string }>(
    `SELECT id FROM transactions
     WHERE acct = ? AND tombstone = 0 AND amount = ?
       AND IFNULL(projected, 0) = 0 AND date >= ? AND date <= ?`,
    [
      accountId,
      amount,
      db.toDateRepr(addDays(date, -MATCH_WINDOW_DAYS)),
      db.toDateRepr(addDays(date, MATCH_WINDOW_DAYS)),
    ],
  );
  return row != null;
}

/**
 * Pairs each charge with a hand-typed entry of the same amount, each entry
 * used once: one already on the statement's bill first, then the closest in
 * date. Payments are left to bank-sync matching.
 */
function pairWithManualRows(
  accountId: AccountEntity['id'],
  statement: CardStatement,
  rows: StatementRow[],
  manual: ManualRow[],
  skip: Set<string>,
) {
  const entries = statement.entries;
  const bill = statement.dueDate.slice(0, 7);
  const available = [...manual];
  const paired = new Map<string, ManualRow>();
  rows.forEach((row, index) => {
    if (entries[index].isPayment || skip.has(row.transactionId)) {
      return;
    }
    const amount = entries[index].amount;
    const candidates = available
      .filter(candidate => candidate.amount === amount)
      .map(candidate => ({
        candidate,
        onBill: billMonthOf(accountId, candidate.card_bill) === bill,
        distance: Math.abs(
          differenceInCalendarDays(db.fromDateRepr(candidate.date), row.date),
        ),
      }))
      .filter(({ distance }) => distance <= REPLACE_WINDOW_DAYS)
      .sort(
        (a, b) =>
          Number(b.onBill) - Number(a.onBill) || a.distance - b.distance,
      );
    const best = candidates[0]?.candidate;
    if (best) {
      paired.set(row.transactionId, best);
      available.splice(available.indexOf(best), 1);
    }
  });
  return paired;
}

async function planImport(
  accountId: AccountEntity['id'],
  text: StatementText,
): Promise<ImportPlan | StatementFailure> {
  if (!(await isCard(accountId))) {
    return { error: 'not-a-card' };
  }
  const read = readStatement(text);
  if ('error' in read) {
    return read;
  }
  const { statement, issuerName } = read;
  const rows = toStatementRows(statement);
  const imported = await loadImportedIds(
    accountId,
    rows.map(row => row.transactionId),
  );
  const replaced = pairWithManualRows(
    accountId,
    statement,
    rows,
    await loadManualRows(accountId),
    imported,
  );

  const entries: StatementPreviewEntry[] = [];
  for (const [index, entry] of statement.entries.entries()) {
    const row = rows[index];
    const manual = replaced.get(row.transactionId);
    let status: StatementEntryStatus = 'new';
    if (imported.has(row.transactionId)) {
      status = 'imported';
    } else if (manual) {
      status = 'replaces';
    } else if (
      entry.isPayment &&
      (await hasPaymentOnCard(accountId, entry.amount, row.date))
    ) {
      status = 'on-card';
    }
    entries.push({
      ...entry,
      postingDate: postingDate(entry, statement),
      status,
      replaces: manual
        ? {
            id: manual.id,
            date: db.fromDateRepr(manual.date),
            notes: manual.notes,
          }
        : null,
    });
  }
  return { statement, issuerName, rows, entries, replaced };
}

export async function previewCardStatement(
  accountId: AccountEntity['id'],
  text: StatementText,
): Promise<StatementPreviewResult> {
  const plan = await planImport(accountId, text);
  if ('error' in plan) {
    return plan;
  }
  const { entries: _entries, ...statement } = plan.statement;
  return {
    preview: {
      issuer: plan.statement.issuer,
      issuerName: plan.issuerName,
      statement,
      entries: plan.entries,
    },
  };
}

/**
 * Imports a statement into a card account the way bank sync would: the bill
 * with its total, dates and minimum, then its entries. Entries typed in by
 * hand that the statement lists are replaced, keeping their category.
 * Importing the same statement again changes nothing.
 */
export async function importCardStatement(
  accountId: AccountEntity['id'],
  text: StatementText,
): Promise<StatementImportResult> {
  const plan = await planImport(accountId, text);
  if ('error' in plan) {
    return plan;
  }

  await applyCardSnapshot(accountId, toCardSnapshot(plan.statement));
  for (const manual of plan.replaced.values()) {
    await db.deleteTransaction({ id: manual.id });
  }

  // A replacing row was already paired; bank-sync matching must not merge
  // it with another entry typed in by hand.
  const rows = plan.rows.map(row =>
    plan.replaced.has(row.transactionId)
      ? { ...row, forceAddTransaction: true }
      : row,
  );
  const result = await reconcileTransactions(accountId, rows, {
    isBankSyncAccount: true,
    refreshRawSyncedData: true,
  });

  for (const [importedId, manual] of plan.replaced) {
    if (!manual.category) {
      continue;
    }
    const row = await db.first<{ id: string; category: string | null }>(
      `SELECT id, category FROM transactions
       WHERE acct = ? AND financial_id = ? AND tombstone = 0`,
      [accountId, importedId],
    );
    if (row && !row.category) {
      await db.updateTransaction({ id: row.id, category: manual.category });
    }
  }

  await reconcileCardAccount(accountId);
  await finishAnyImport();
  return {
    added: result.added.length,
    updated: result.updated.length,
    replaced: plan.replaced.size,
  };
}
