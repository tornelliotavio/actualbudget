import { logger } from '#platform/server/log';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { mergeTransactions } from '#server/transactions/merge';
import { addDays, currentDay, differenceInCalendarDays } from '#shared/months';
import { q } from '#shared/query';
import type { AccountEntity, TransactionEntity } from '#types/models';

/** How far apart the two sides of a bill payment may be dated. */
const MAX_DAYS_APART = 5;
/** How far back unlinked payments are looked at on each sync. */
const LOOKBACK_DAYS = 60;
/** How far a payment may be from the date a bill schedule expected it. */
const SCHEDULE_WINDOW_DAYS = 15;

type Row = Pick<
  TransactionEntity,
  | 'id'
  | 'account'
  | 'date'
  | 'amount'
  | 'transfer_id'
  | 'imported_id'
  | 'schedule'
  | 'category'
  | 'reconciled'
> & { offbudget: boolean };

export type PaymentLinkResult = {
  linked: number;
  merged: number;
  /** Payments with more than one plausible counterpart, left alone. */
  ambiguous: Array<{ paymentId: string; candidateIds: string[] }>;
};

async function transferPayee(accountId: AccountEntity['id']) {
  const payee = await db.first<{ id: string }>(
    'SELECT id FROM payees WHERE transfer_acct = ? AND tombstone = 0',
    [accountId],
  );
  return payee?.id ?? null;
}

async function select(query: ReturnType<typeof q>): Promise<Row[]> {
  const { data } = await aqlQuery(
    query.select([
      'id',
      'account',
      'date',
      'amount',
      'transfer_id',
      'imported_id',
      'schedule',
      'category',
      'reconciled',
      { offbudget: 'account.offbudget' },
    ]),
  );
  return data as Row[];
}

/**
 * Marks the payment against the schedule that pays this card, so the
 * schedule counts as paid and moves to its next date.
 */
async function linkSchedule(row: Row, cardPayee: string) {
  if (row.schedule) {
    return;
  }
  const { data } = await aqlQuery(
    q('schedules')
      .filter({ completed: false, _payee: cardPayee })
      .select(['id', 'next_date']),
  );
  const schedule = (data as Array<{ id: string; next_date: string | null }>)
    .filter(
      candidate =>
        candidate.next_date &&
        Math.abs(differenceInCalendarDays(candidate.next_date, row.date)) <=
          SCHEDULE_WINDOW_DAYS,
    )
    .sort(
      (a, b) =>
        Math.abs(differenceInCalendarDays(a.next_date!, row.date)) -
        Math.abs(differenceInCalendarDays(b.next_date!, row.date)),
    )[0];
  if (schedule) {
    await db.updateTransaction({ id: row.id, schedule: schedule.id });
  }
}

async function link(payment: Row, other: Row) {
  const [cardPayee, otherPayee] = await Promise.all([
    transferPayee(payment.account),
    transferPayee(other.account),
  ]);
  if (!cardPayee || !otherPayee) {
    return false;
  }
  await db.updateTransaction({
    id: other.id,
    payee: cardPayee,
    transfer_id: payment.id,
    category: null,
  });
  await db.updateTransaction({
    id: payment.id,
    payee: otherPayee,
    transfer_id: other.id,
    category: null,
  });
  await linkSchedule(other, cardPayee);
  return true;
}

async function schedulesPaying(cardPayee: string | null) {
  if (!cardPayee) {
    return new Set<string>();
  }
  const { data } = await aqlQuery(
    q('schedules').filter({ _payee: cardPayee }).select(['id']),
  );
  return new Set((data as Array<{ id: string }>).map(row => row.id));
}

/**
 * Turns bill payments imported on both sides into transfers: the card's
 * payment credit and the matching debit in another account become one
 * transfer instead of an uncategorized expense plus an unexplained credit.
 * When the other side was already a transfer whose card half was created
 * locally, the imported credit replaces that half.
 */
export async function linkCardPayments({
  today = currentDay(),
}: { today?: string } = {}): Promise<PaymentLinkResult> {
  const result: PaymentLinkResult = { linked: 0, merged: 0, ambiguous: [] };
  const cards = await db.all<{ id: string; offbudget: number }>(
    "SELECT id, offbudget FROM accounts WHERE kind = 'credit_card' AND tombstone = 0 AND closed = 0",
  );
  const cardIds = new Set(cards.map(card => card.id));

  for (const card of cards) {
    const cardSchedules = await schedulesPaying(await transferPayee(card.id));
    const payments = await select(
      q('transactions').filter({
        account: card.id,
        card_kind: 'payment',
        transfer_id: null,
        projected: false,
        amount: { $gt: 0 },
        date: { $gte: addDays(today, -LOOKBACK_DAYS) },
      }),
    );

    for (const payment of payments) {
      const others = (
        await select(
          q('transactions').filter({
            $and: [
              { amount: -payment.amount },
              { date: { $gte: addDays(payment.date, -MAX_DAYS_APART) } },
              { date: { $lte: addDays(payment.date, MAX_DAYS_APART) } },
              { starting_balance_flag: false },
              { projected: false },
              { is_child: false },
            ],
          }),
        )
      ).filter(row => !cardIds.has(row.account));

      const counterpartIds = others
        .map(row => row.transfer_id)
        .filter((id): id is string => id != null);
      const halves =
        counterpartIds.length === 0
          ? []
          : await select(
              q('transactions').filter({
                account: card.id,
                id: { $oneof: counterpartIds },
                imported_id: null,
              }),
            );
      if (halves.length === 1) {
        await mergeTransactions([payment, halves[0]]);
        result.merged++;
        continue;
      }

      // Only a bank debit nobody has explained yet: imported, not
      // reconciled, in an account on the same side of the budget, and
      // uncategorized or already marked as paying this card.
      const candidates = others.filter(
        row =>
          row.transfer_id == null &&
          row.imported_id != null &&
          !row.reconciled &&
          Boolean(row.offbudget) === (card.offbudget === 1) &&
          (row.category == null ||
            (row.schedule != null && cardSchedules.has(row.schedule))),
      );
      if (candidates.length === 1) {
        if (await link(payment, candidates[0])) {
          result.linked++;
        }
      } else if (candidates.length > 1) {
        result.ambiguous.push({
          paymentId: payment.id,
          candidateIds: candidates.map(row => row.id),
        });
      }
    }
  }

  if (result.ambiguous.length > 0) {
    logger.log('Card payments with several counterparts', result.ambiguous);
  }
  return result;
}
