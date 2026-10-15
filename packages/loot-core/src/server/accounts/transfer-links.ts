import { logger } from '#platform/server/log';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { mergeTransactions } from '#server/transactions/merge';
import { addDays, currentDay } from '#shared/months';
import { q } from '#shared/query';
import type { AccountEntity, TransactionEntity } from '#types/models';

/** How far apart the two sides of a transfer may be dated. */
const MAX_DAYS_APART = 2;
/** How far apart an imported row and a transfer entered by hand may be. */
const MAX_DAYS_FROM_MANUAL = 5;
/** How far back unlinked transactions are looked at on each sync. */
const LOOKBACK_DAYS = 60;

/** Pluggy operation types that move money between accounts. */
const TRANSFER_OPERATIONS = new Set([
  'PIX',
  'TED',
  'DOC',
  'TRANSFERENCIA_MESMA_INSTITUICAO',
  'TRANSFERENCIA_OUTRA_INSTITUICAO',
  'TRANSFERENCIA',
]);
const TRANSFER_WORDS =
  /\b(pix|ted|doc|transf(er[eê]ncia)?|pagamento\s+(de\s+)?fatura)\b/i;

type Row = Pick<
  TransactionEntity,
  | 'id'
  | 'account'
  | 'date'
  | 'amount'
  | 'transfer_id'
  | 'imported_id'
  | 'category'
  | 'notes'
  | 'imported_payee'
  | 'raw_synced_data'
> & { offbudget: boolean };

export type TransferLinkResult = {
  /** Imported rows that replaced a transfer entered by hand. */
  merged: number;
  /** Pairs of imported rows turned into one transfer. */
  linked: number;
};

async function select(filter: Record<string, unknown>): Promise<Row[]> {
  const { data } = await aqlQuery(
    q('transactions')
      .filter(filter)
      .select([
        'id',
        'account',
        'date',
        'amount',
        'transfer_id',
        'imported_id',
        'category',
        'notes',
        'imported_payee',
        'raw_synced_data',
        { offbudget: 'account.offbudget' },
      ]),
  );
  return data as Row[];
}

function looksLikeTransfer(row: Row) {
  try {
    const raw = row.raw_synced_data ? JSON.parse(row.raw_synced_data) : null;
    if (raw && TRANSFER_OPERATIONS.has(String(raw.operationType))) {
      return true;
    }
  } catch {
    // Unreadable bank data: fall back to the description.
  }
  return TRANSFER_WORDS.test(`${row.notes ?? ''} ${row.imported_payee ?? ''}`);
}

/** A bank transaction nobody explained yet. */
const unexplained = (since: string) => ({
  $and: [
    { date: { $gte: since } },
    { imported_id: { $ne: null } },
    { transfer_id: null },
    { category: null },
    { reconciled: false },
    { is_child: false },
    { is_parent: false },
    { starting_balance_flag: false },
    { projected: false },
    // Card payments are linked with their bill (credit-cards/).
    { 'account.kind': { $ne: 'credit_card' } },
  ],
});

async function transferPayee(accountId: AccountEntity['id']) {
  const payee = await db.first<{ id: string }>(
    'SELECT id FROM payees WHERE transfer_acct = ? AND tombstone = 0',
    [accountId],
  );
  return payee?.id ?? null;
}

async function linkPair(debit: Row, credit: Row) {
  const [toCredit, toDebit] = await Promise.all([
    transferPayee(credit.account),
    transferPayee(debit.account),
  ]);
  if (!toCredit || !toDebit) {
    return false;
  }
  await db.updateTransaction({
    id: debit.id,
    payee: toCredit,
    transfer_id: credit.id,
    category: null,
  });
  await db.updateTransaction({
    id: credit.id,
    payee: toDebit,
    transfer_id: debit.id,
    category: null,
  });
  return true;
}

function withinDays(a: string, b: string, days: number) {
  return a >= addDays(b, -days) && a <= addDays(b, days);
}

/**
 * A transfer entered by hand (or posted by a schedule) and its bank copy
 * imported later are one movement: the imported row takes its place and
 * keeps the transfer, so the account doesn't show it twice.
 */
async function mergeIntoManualTransfers(since: string) {
  let merged = 0;
  const manual = await select({
    $and: [
      { date: { $gte: addDays(since, -MAX_DAYS_FROM_MANUAL) } },
      { imported_id: null },
      { transfer_id: { $ne: null } },
      { is_child: false },
      { 'account.kind': { $ne: 'credit_card' } },
    ],
  });
  if (manual.length === 0) {
    return merged;
  }
  const imported = (await select(unexplained(since))).filter(looksLikeTransfer);

  for (const transfer of manual) {
    const matches = imported.filter(
      row =>
        row.account === transfer.account &&
        row.amount === transfer.amount &&
        withinDays(row.date, transfer.date, MAX_DAYS_FROM_MANUAL),
    );
    const claims = manual.filter(
      other =>
        matches.length === 1 &&
        other.account === transfer.account &&
        other.amount === transfer.amount &&
        withinDays(matches[0].date, other.date, MAX_DAYS_FROM_MANUAL),
    );
    if (matches.length === 1 && claims.length === 1) {
      await mergeTransactions([{ id: transfer.id }, { id: matches[0].id }]);
      imported.splice(imported.indexOf(matches[0]), 1);
      merged++;
    }
  }
  return merged;
}

/**
 * A debit in one of the user's accounts and a credit of the same amount in
 * another, both imported within two days and both described as a transfer
 * (Pix, TED, DOC...), are the two sides of one transfer. Each side must have
 * exactly one candidate on the other, so two same-amount movements on the
 * same days are left alone.
 */
async function linkOwnTransfers(since: string) {
  let linked = 0;
  const rows = (await select(unexplained(addDays(since, -MAX_DAYS_APART))))
    .filter(looksLikeTransfer)
    .filter(row => row.amount !== 0);
  const debits = rows.filter(row => row.amount < 0 && row.date >= since);
  const credits = rows.filter(row => row.amount > 0);
  const counterparts = (row: Row, pool: Row[]) =>
    pool.filter(
      other =>
        other.account !== row.account &&
        other.amount === -row.amount &&
        Boolean(other.offbudget) === Boolean(row.offbudget) &&
        withinDays(other.date, row.date, MAX_DAYS_APART),
    );
  const used = new Set<string>();

  for (const debit of debits) {
    const forDebit = counterparts(debit, credits).filter(
      row => !used.has(row.id),
    );
    if (forDebit.length !== 1) {
      continue;
    }
    const credit = forDebit[0];
    if (counterparts(credit, debits).length !== 1) {
      continue;
    }
    if (await linkPair(debit, credit)) {
      used.add(credit.id);
      linked++;
    }
  }
  return linked;
}

/** Runs after a bank sync, once card payments were linked. */
export async function linkTransfers({
  today = currentDay(),
}: { today?: string } = {}): Promise<TransferLinkResult> {
  const since = addDays(today, -LOOKBACK_DAYS);
  const merged = await mergeIntoManualTransfers(since);
  const linked = await linkOwnTransfers(since);
  if (merged > 0 || linked > 0) {
    logger.log('Linked transfers between accounts', { merged, linked });
  }
  return { merged, linked };
}
