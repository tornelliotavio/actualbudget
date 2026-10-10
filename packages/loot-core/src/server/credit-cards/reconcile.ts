import * as db from '#server/db';
import { currentDay } from '#shared/months';

import { getCreditCardRow } from './cards';
import { installmentId } from './engine';
import {
  planInstallments,
  unpostedInstallments,
} from './engine/installment-plans';
import { isProjectionError, projectCard } from './project';
import {
  insertReviewItem,
  listCardTransactions,
  listPayments,
  upsertPayment,
} from './records';
import type { CardTransaction } from './records';

export type ReconcileResult = {
  purchases: number;
  installmentsLinked: number;
  paymentsLinked: number;
  reviews: number;
};

async function ensureReview(input: {
  id: string;
  cardId: string;
  kind: string;
  subjectId: string;
  candidates: string;
}): Promise<boolean> {
  const existing = await db.first<{ id: string }>(
    'SELECT id FROM credit_card_review_items WHERE id = ?',
    [input.id],
  );
  if (existing) {
    return false;
  }
  await insertReviewItem({
    ...input,
    createdAt: new Date(Date.now()).toISOString(),
  });
  return true;
}

async function groupInstallments(
  cardId: string,
  transactions: CardTransaction[],
): Promise<
  Pick<ReconcileResult, 'purchases' | 'installmentsLinked' | 'reviews'>
> {
  let purchases = 0;
  let installmentsLinked = 0;
  let reviews = 0;

  const planned = planInstallments(cardId, transactions);
  const linkedRows = await db.all<{ transaction_id: string }>(
    `SELECT transaction_id FROM credit_card_installments
     WHERE card_id = ? AND tombstone = 0 AND transaction_id IS NOT NULL`,
    [cardId],
  );
  const linkedTransactionIds = new Set(
    linkedRows.map(row => row.transaction_id),
  );

  for (const conflict of planned.conflicts) {
    const created = await ensureReview({
      id: `review:${cardId}:installment:${conflict.transactionId}`,
      cardId,
      kind: 'installment',
      subjectId: conflict.transactionId,
      candidates: JSON.stringify([conflict.planId, conflict.number]),
    });
    if (created) {
      reviews += 1;
    }
  }

  for (const plan of planned.plans) {
    const existing = await db.first<{ id: string }>(
      'SELECT id FROM credit_card_purchases WHERE id = ? AND tombstone = 0',
      [plan.id],
    );
    const represented = plan.parts.some(
      part =>
        part.transactionId != null &&
        linkedTransactionIds.has(part.transactionId),
    );
    if (!existing && represented) {
      continue;
    }
    if (!existing) {
      const future = new Set(
        unpostedInstallments(plan).map(part => part.number),
      );
      await db.insertWithUUID('credit_card_purchases', {
        id: plan.id,
        card_id: cardId,
        purchase_date: plan.purchaseDate,
        merchant: plan.merchant,
        description: plan.notes,
        total_amount: plan.totalAmount,
        installment_count: plan.installmentCount,
        category_id: null,
        provider_purchase_key: plan.id,
        source: 'pluggyai',
        status: 'open',
        tombstone: 0,
      });
      for (const part of plan.parts) {
        if (part.transactionId == null && !future.has(part.number)) {
          continue;
        }
        await db.insertWithUUID('credit_card_installments', {
          id: installmentId(plan.id, part.number),
          purchase_id: plan.id,
          card_id: cardId,
          installment_number: part.number,
          total_installments: plan.installmentCount,
          amount: part.amount,
          bill_id_override: null,
          transaction_id: null,
          provider_transaction_id: null,
          status: 'projected',
          tombstone: 0,
        });
      }
      purchases += 1;
    }

    for (const part of plan.parts) {
      if (part.transactionId == null) {
        continue;
      }
      const installmentKey = installmentId(plan.id, part.number);
      const installment = await db.first<{
        transaction_id: string | null;
      }>(
        'SELECT transaction_id FROM credit_card_installments WHERE id = ? AND tombstone = 0',
        [installmentKey],
      );
      if (!installment) {
        continue;
      }
      if (installment.transaction_id === part.transactionId) {
        continue;
      }
      if (installment.transaction_id) {
        const created = await ensureReview({
          id: `review:${cardId}:installment:${installmentKey}`,
          cardId,
          kind: 'installment',
          subjectId: installmentKey,
          candidates: JSON.stringify([
            installment.transaction_id,
            part.transactionId,
          ]),
        });
        if (created) {
          reviews += 1;
        }
        continue;
      }
      await db.update('credit_card_installments', {
        id: installmentKey,
        transaction_id: part.transactionId,
        provider_transaction_id: part.transactionId,
        status: 'imported',
      });
      linkedTransactionIds.add(part.transactionId);
      installmentsLinked += 1;
    }
  }

  return { purchases, installmentsLinked, reviews };
}

async function linkPayments(
  cardId: string,
  transactions: CardTransaction[],
  today: string,
): Promise<Pick<ReconcileResult, 'paymentsLinked' | 'reviews'>> {
  let paymentsLinked = 0;
  let reviews = 0;
  const already = new Set(
    (await listPayments(cardId))
      .map(payment => payment.transactionId)
      .filter(id => id != null),
  );

  for (const transaction of transactions) {
    if (!transaction.transferId || transaction.amount <= 0) {
      continue;
    }
    if (already.has(transaction.id)) {
      continue;
    }
    const projection = await projectCard(cardId, today);
    if (isProjectionError(projection)) {
      continue;
    }
    const matches = projection.bills.filter(
      bill => bill.remaining > 0 && bill.remaining === transaction.amount,
    );
    if (matches.length > 1) {
      const created = await ensureReview({
        id: `review:${cardId}:payment:${transaction.id}`,
        cardId,
        kind: 'payment',
        subjectId: transaction.id,
        candidates: JSON.stringify(matches.map(bill => bill.id)),
      });
      if (created) {
        reviews += 1;
      }
      continue;
    }
    const match = matches[0];
    if (!match) {
      continue;
    }
    await upsertPayment({
      id: `${transaction.id}:${match.id}`,
      cardId,
      billId: match.id,
      transactionId: transaction.id,
      bankTransactionId: transaction.transferId,
      amount: transaction.amount,
      paymentDate: transaction.date,
      source: 'rule',
      status: 'confirmed',
    });
    already.add(transaction.id);
    paymentsLinked += 1;
  }

  return { paymentsLinked, reviews };
}

export async function reconcileCard(
  cardId: string,
  today = currentDay(),
): Promise<ReconcileResult | { error: string }> {
  const card = await getCreditCardRow(cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  const transactions = (await listCardTransactions(card.accountId)).filter(
    transaction => !transaction.isParent && !transaction.startingBalance,
  );
  const grouped = await groupInstallments(card.id, transactions);
  const payments = await linkPayments(card.id, transactions, today);
  return {
    purchases: grouped.purchases,
    installmentsLinked: grouped.installmentsLinked,
    paymentsLinked: payments.paymentsLinked,
    reviews: grouped.reviews + payments.reviews,
  };
}
