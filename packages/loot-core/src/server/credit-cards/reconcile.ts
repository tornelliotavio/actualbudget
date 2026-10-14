import { logger } from '#platform/server/log';
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import { currentDay } from '#shared/months';
import type {
  AccountEntity,
  CardPurchaseEntity,
  TransactionEntity,
} from '#types/models';

import { reconcileBillAdjustments } from './adjustments';
import { calendarFor, classifyOptions, toCardEntry } from './card-entries';
import { billRowId } from './engine/ids';
import type { EntryPlan, PlanSuggestion, ProjectedPlan } from './engine/plan';
import { planCardAccount } from './engine/plan';
import type { Purchase } from './engine/types';
import { loadCardAccountState, suppressImport } from './store';

export type ReconcileStatus = 'ok' | 'not-a-card' | 'needs-schedule';

export type ReconcileResult = {
  status: ReconcileStatus;
  suggestions: PlanSuggestion[];
};

function toPurchase(row: CardPurchaseEntity): Purchase {
  return {
    id: row.id,
    stem: row.stem,
    installmentCount: row.installment_count,
    anchorMonth: row.anchor_month,
    cardLast4: row.card_last4,
    purchaseDate: row.purchase_date,
    totalAmount: row.total_amount,
    status: row.status,
  };
}

function changedFields<T extends Record<string, unknown>>(
  current: Record<string, unknown>,
  desired: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(desired).filter(
      ([key, value]) => (current[key] ?? null) !== (value ?? null),
    ),
  ) as Partial<T>;
}

function entryColumns(accountId: AccountEntity['id'], plan: EntryPlan) {
  return {
    card_bill: billRowId(accountId, plan.bill),
    card_bill_source: plan.billSource,
    card_kind: plan.kind,
    card_purchase: plan.purchaseId,
    installment_number: plan.installmentNumber,
    installment_count: plan.installmentCount,
    date: plan.date,
    budget_date: plan.budgetDate,
  };
}

async function writePurchases(
  accountId: AccountEntity['id'],
  stored: CardPurchaseEntity[],
  desired: Purchase[],
  removed: string[],
) {
  const byId = new Map(stored.map(row => [row.id, row]));
  for (const purchase of desired) {
    const columns = {
      account: accountId,
      stem: purchase.stem,
      installment_count: purchase.installmentCount,
      anchor_month: purchase.anchorMonth,
      card_last4: purchase.cardLast4,
      purchase_date: purchase.purchaseDate,
      total_amount: purchase.totalAmount,
      status: purchase.status,
    };
    const current = byId.get(purchase.id);
    if (!current) {
      await db.insertWithSchema('card_purchases', {
        id: purchase.id,
        ...columns,
      });
      continue;
    }
    const changes = changedFields(current, columns);
    if (Object.keys(changes).length > 0) {
      await db.updateWithSchema('card_purchases', {
        id: purchase.id,
        ...changes,
      });
    }
  }
  for (const id of removed) {
    if (byId.has(id)) {
      await db.delete_('card_purchases', id);
    }
  }
}

async function writeProjected(
  accountId: AccountEntity['id'],
  transactions: Map<string, TransactionEntity>,
  rows: ProjectedPlan[],
) {
  for (const row of rows) {
    const template = transactions.get(row.templateId);
    const columns = {
      ...entryColumns(accountId, row),
      amount: row.amount,
    };
    const current = transactions.get(row.id);
    if (current) {
      const changes: Record<string, unknown> = changedFields(current, columns);
      if (!current.category && template?.category) {
        changes.category = template.category;
      }
      if (Object.keys(changes).length > 0) {
        await db.updateTransaction({ id: row.id, ...changes });
      }
      continue;
    }
    await db.insertTransaction({
      id: row.id,
      account: accountId,
      payee: template?.payee ?? null,
      category: template?.category ?? null,
      notes: template?.notes ?? null,
      imported_payee: template?.imported_payee ?? null,
      cleared: false,
      projected: true,
      // The id is deterministic and may belong to a projection removed
      // earlier, such as one of a purchase that was cancelled and resumed.
      tombstone: false,
      ...columns,
    });
  }
}

/**
 * Brings a credit card account's derived state in line with its
 * transactions: bill of every transaction, installment purchases, projected
 * installments and budget dates. Idempotent: a second run writes nothing.
 */
export async function reconcileCardAccount(
  accountId: AccountEntity['id'],
  { today = currentDay() }: { today?: string } = {},
): Promise<ReconcileResult> {
  const state = await loadCardAccountState(accountId);
  if (!state) {
    return { status: 'not-a-card', suggestions: [] };
  }
  const calendar = calendarFor(state);
  if (!calendar) {
    return { status: 'needs-schedule', suggestions: [] };
  }

  const plan = planCardAccount({
    accountId,
    calendar,
    billMonthByProviderId: new Map(
      state.bills
        .filter(bill => bill.provider_bill_id)
        .map(bill => [bill.provider_bill_id!, bill.reference_month]),
    ),
    entries: state.transactions.map(transaction =>
      toCardEntry(accountId, transaction),
    ),
    purchases: state.purchases.map(toPurchase),
    deletedProjectedIds: state.deletedProjectedIds,
    today,
    classify: classifyOptions(state),
  });

  const transactions = new Map(
    state.transactions.map(transaction => [transaction.id, transaction]),
  );

  await batchMessages(async () => {
    await writePurchases(
      accountId,
      state.purchases,
      plan.purchases,
      plan.removePurchases,
    );

    for (const entry of plan.entries) {
      const current = transactions.get(entry.id);
      if (!current) {
        continue;
      }
      const desired: Partial<ReturnType<typeof entryColumns>> = entryColumns(
        accountId,
        entry,
      );
      // The first reconciliation moves a transaction to the bank's date;
      // after that a date the user set stays, except on installments, whose
      // dates follow their bills.
      if (current.card_bill && entry.kind !== 'installment') {
        delete desired.date;
      }
      const changes = changedFields(current, desired);
      if (Object.keys(changes).length > 0) {
        await db.updateTransaction({ id: entry.id, ...changes });
      }
    }

    await writeProjected(accountId, transactions, plan.projected);

    for (const { fromId, toId } of plan.inherit) {
      const from = transactions.get(fromId);
      const to = transactions.get(toId);
      if (!from || !to) {
        continue;
      }
      const carried = {
        ...(!to.category && from.category ? { category: from.category } : {}),
        ...(!to.payee && from.payee ? { payee: from.payee } : {}),
      };
      if (Object.keys(carried).length > 0) {
        await db.updateTransaction({ id: toId, ...carried });
      }
    }

    for (const id of plan.removeProjected) {
      // Only projections the user deleted stay marked as projected once
      // deleted; those are never created again.
      await db.updateTransaction({ id, projected: false });
      await db.deleteTransaction({ id });
    }

    for (const id of state.deletedProjectedIds) {
      await suppressImport(accountId, id, 'projected-deleted');
    }
  });

  await reconcileBillAdjustments(accountId, today);

  if (plan.suggestions.length > 0) {
    logger.log('Credit card suggestions', accountId, plan.suggestions);
  }

  return { status: 'ok', suggestions: plan.suggestions };
}
