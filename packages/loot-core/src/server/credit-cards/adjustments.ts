import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import type { AccountEntity } from '#types/models';

import { summarizeCardState } from './bills';
import { billMonthOf, calendarFor } from './card-entries';
import { planBillAdjustments } from './engine/adjustments';
import type { AdjustmentRow } from './engine/adjustments';
import { billRowId } from './engine/ids';
import type { DateString } from './engine/types';
import { loadCardAccountState } from './store';

const NOTES = 'Finance charges on this bill (interest, IOF, fees)';

/**
 * Keeps one finance-charge transaction per bill whose bank total includes
 * charges the bank never sent as transactions.
 */
export async function reconcileBillAdjustments(
  accountId: AccountEntity['id'],
  today: DateString,
) {
  const state = await loadCardAccountState(accountId);
  const calendar = state && calendarFor(state);
  if (!state || !calendar) {
    return;
  }

  const existing: AdjustmentRow[] = state.transactions
    .filter(transaction => transaction.card_bill_source === 'adjustment')
    .map(transaction => ({
      id: transaction.id,
      bill: billMonthOf(accountId, transaction.card_bill) ?? '',
      amount: transaction.amount,
    }));
  const deleted = await db.all<{ id: string }>(
    `SELECT id FROM transactions
     WHERE acct = ? AND tombstone = 1 AND card_bill_source = 'adjustment'`,
    [accountId],
  );

  const plan = planBillAdjustments({
    accountId,
    calendar,
    bills: summarizeCardState(
      state,
      calendar,
      today,
      new Set(existing.map(row => row.id)),
    ),
    financeChargesByMonth: new Map(
      state.bills
        .filter(bill => bill.provider_finance_charges != null)
        .map(bill => [bill.reference_month, bill.provider_finance_charges!]),
    ),
    existing,
    deletedIds: new Set(deleted.map(row => row.id)),
    from: state.profile?.adjustments_from ?? null,
  });
  if (plan.upsert.length === 0 && plan.remove.length === 0) {
    return;
  }

  const stored = new Set(existing.map(row => row.id));
  await batchMessages(async () => {
    for (const row of plan.upsert) {
      const columns = {
        amount: row.amount,
        date: row.date,
        budget_date: row.budgetDate,
        card_bill: billRowId(accountId, row.bill),
        card_bill_source: 'adjustment',
        card_kind: 'fee',
      };
      if (stored.has(row.id)) {
        await db.updateTransaction({ id: row.id, ...columns });
      } else {
        await db.insertTransaction({
          id: row.id,
          account: accountId,
          notes: NOTES,
          cleared: true,
          // The id is deterministic and may belong to a removed adjustment.
          tombstone: false,
          ...columns,
        });
      }
    }
    for (const id of plan.remove) {
      // Only adjustments the user deleted keep their source once deleted.
      await db.updateTransaction({ id, card_bill_source: null });
      await db.deleteTransaction({ id });
    }
  });
}
