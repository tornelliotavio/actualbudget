import * as db from '#server/db';
import { currentDay } from '#shared/months';
import { amountToInteger } from '#shared/util';

import { getCreditCardRow } from './cards';
import {
  installmentId,
  purchaseFingerprint,
  readCardMetadata,
  splitInstallments,
} from './engine';
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

function centsFromReais(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return amountToInteger(value);
}

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

  for (const transaction of transactions) {
    if (transaction.transferId || transaction.amount >= 0) {
      continue;
    }
    const metadata = readCardMetadata(transaction.rawSyncedData);
    const count = metadata?.totalInstallments ?? null;
    const number = metadata?.installmentNumber ?? null;
    if (count == null || number == null || count < 2) {
      continue;
    }
    if (number < 1 || number > count) {
      continue;
    }
    const purchaseDate =
      metadata?.purchaseDate || metadata?.originalDate || transaction.date;
    const totalAmount = centsFromReais(metadata?.totalAmount ?? null);
    if (
      !purchaseDate ||
      totalAmount == null ||
      !Number.isInteger(totalAmount)
    ) {
      const created = await ensureReview({
        id: `review:${cardId}:installment:${transaction.id}`,
        cardId,
        kind: 'installment',
        subjectId: transaction.id,
        candidates: '[]',
      });
      if (created) {
        reviews += 1;
      }
      continue;
    }

    const description = transaction.payeeName || transaction.notes || '';
    const purchaseId = purchaseFingerprint({
      cardId,
      purchaseDate,
      totalAmount,
      installmentCount: count,
      description,
    });
    const existing = await db.first<{ id: string }>(
      'SELECT id FROM credit_card_purchases WHERE id = ? AND tombstone = 0',
      [purchaseId],
    );
    if (!existing) {
      const parts = splitInstallments(totalAmount, count);
      await db.insertWithUUID('credit_card_purchases', {
        id: purchaseId,
        card_id: cardId,
        purchase_date: purchaseDate,
        merchant: transaction.payeeName,
        description: transaction.notes,
        total_amount: totalAmount,
        installment_count: count,
        category_id: null,
        provider_purchase_key: purchaseId,
        source: 'pluggyai',
        status: 'open',
        tombstone: 0,
      });
      for (let index = 0; index < parts.length; index++) {
        const part = index + 1;
        await db.insertWithUUID('credit_card_installments', {
          id: installmentId(purchaseId, part),
          purchase_id: purchaseId,
          card_id: cardId,
          installment_number: part,
          total_installments: count,
          amount: parts[index],
          bill_id_override: null,
          transaction_id: null,
          provider_transaction_id: null,
          status: 'projected',
          tombstone: 0,
        });
      }
      purchases += 1;
    }

    const installmentKey = installmentId(purchaseId, number);
    const installment = await db.first<{
      transaction_id: string | null;
    }>(
      'SELECT transaction_id FROM credit_card_installments WHERE id = ? AND tombstone = 0',
      [installmentKey],
    );
    if (!installment) {
      continue;
    }
    if (installment.transaction_id === transaction.id) {
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
          transaction.id,
        ]),
      });
      if (created) {
        reviews += 1;
      }
      continue;
    }
    await db.update('credit_card_installments', {
      id: installmentKey,
      transaction_id: transaction.id,
      provider_transaction_id: transaction.id,
      status: 'imported',
    });
    installmentsLinked += 1;
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
