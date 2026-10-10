import * as db from '#server/db';
import { fromDateRepr } from '#server/models';

import { addCalendarMonths, installmentId, splitInstallments } from './engine';
import type { ChargeKind, InstallmentStatus } from './engine';

export type StoredBill = {
  id: string;
  cardId: string;
  referenceMonth: string;
  cycleStart: string | null;
  cycleEnd: string | null;
  closingDate: string | null;
  dueDate: string | null;
  confirmedTotal: number | null;
  minimumPayment: number | null;
  source: string | null;
  providerBillId: string | null;
  lastConfirmedAt: string | null;
  cancelled: boolean;
};

export type StoredPurchase = {
  id: string;
  cardId: string;
  purchaseDate: string;
  merchant: string | null;
  description: string | null;
  totalAmount: number;
  installmentCount: number;
  categoryId: string | null;
  providerPurchaseKey: string | null;
  source: string | null;
  status: string | null;
};

export type StoredInstallment = {
  id: string;
  purchaseId: string;
  installmentNumber: number;
  totalInstallments: number;
  amount: number;
  billIdOverride: string | null;
  transactionId: string | null;
  providerTransactionId: string | null;
  status: InstallmentStatus;
};

export type StoredLink = {
  id: string;
  transactionId: string;
  cardId: string;
  billId: string;
  kind: ChargeKind;
  source: string;
};

export type StoredPayment = {
  id: string;
  cardId: string;
  billId: string;
  transactionId: string | null;
  bankTransactionId: string | null;
  amount: number;
  paymentDate: string;
  source: string;
  status: string;
};

export type CardTransaction = {
  id: string;
  date: string;
  amount: number;
  notes: string | null;
  payeeName: string | null;
  transferId: string | null;
  rawSyncedData: string | null;
  startingBalance: boolean;
  isParent: boolean;
};

type BillRow = {
  id: string;
  card_id: string | null;
  reference_month: string | null;
  cycle_start: string | null;
  cycle_end: string | null;
  closing_date: string | null;
  due_date: string | null;
  confirmed_total: number | null;
  minimum_payment: number | null;
  source: string | null;
  provider_bill_id: string | null;
  last_confirmed_at: string | null;
  cancelled: number | null;
};

function toBill(row: BillRow): StoredBill {
  return {
    id: row.id,
    cardId: row.card_id ?? '',
    referenceMonth: row.reference_month ?? '',
    cycleStart: row.cycle_start,
    cycleEnd: row.cycle_end,
    closingDate: row.closing_date,
    dueDate: row.due_date,
    confirmedTotal: row.confirmed_total,
    minimumPayment: row.minimum_payment,
    source: row.source,
    providerBillId: row.provider_bill_id,
    lastConfirmedAt: row.last_confirmed_at,
    cancelled: row.cancelled === 1,
  };
}

export async function listStoredBills(cardId: string): Promise<StoredBill[]> {
  const rows = await db.all<BillRow>(
    'SELECT * FROM credit_card_bills WHERE card_id = ? AND tombstone = 0',
    [cardId],
  );
  return rows.map(toBill);
}

export async function upsertStoredBill(bill: StoredBill): Promise<void> {
  const existing = await db.first<{ id: string }>(
    'SELECT id FROM credit_card_bills WHERE id = ?',
    [bill.id],
  );
  const fields = {
    id: bill.id,
    card_id: bill.cardId,
    reference_month: bill.referenceMonth,
    cycle_start: bill.cycleStart,
    cycle_end: bill.cycleEnd,
    closing_date: bill.closingDate,
    due_date: bill.dueDate,
    confirmed_total: bill.confirmedTotal,
    minimum_payment: bill.minimumPayment,
    source: bill.source,
    provider_bill_id: bill.providerBillId,
    last_confirmed_at: bill.lastConfirmedAt,
    cancelled: bill.cancelled ? 1 : 0,
    tombstone: 0,
  };
  if (existing) {
    await db.update('credit_card_bills', fields);
    return;
  }
  await db.insertWithUUID('credit_card_bills', fields);
}

export async function listPurchases(cardId: string): Promise<StoredPurchase[]> {
  const rows = await db.all<{
    id: string;
    card_id: string | null;
    purchase_date: string | null;
    merchant: string | null;
    description: string | null;
    total_amount: number | null;
    installment_count: number | null;
    category_id: string | null;
    provider_purchase_key: string | null;
    source: string | null;
    status: string | null;
  }>(
    'SELECT * FROM credit_card_purchases WHERE card_id = ? AND tombstone = 0 ORDER BY purchase_date',
    [cardId],
  );
  return rows.map(row => ({
    id: row.id,
    cardId: row.card_id ?? '',
    purchaseDate: row.purchase_date ?? '',
    merchant: row.merchant,
    description: row.description,
    totalAmount: row.total_amount ?? 0,
    installmentCount: row.installment_count ?? 1,
    categoryId: row.category_id,
    providerPurchaseKey: row.provider_purchase_key,
    source: row.source,
    status: row.status,
  }));
}

export async function listInstallments(
  cardId: string,
): Promise<StoredInstallment[]> {
  const rows = await db.all<{
    id: string;
    purchase_id: string | null;
    installment_number: number | null;
    total_installments: number | null;
    amount: number | null;
    bill_id_override: string | null;
    transaction_id: string | null;
    provider_transaction_id: string | null;
    status: string | null;
  }>(
    `SELECT i.* FROM credit_card_installments i
     JOIN credit_card_purchases p ON p.id = i.purchase_id
     WHERE p.card_id = ? AND i.tombstone = 0 AND p.tombstone = 0
     ORDER BY i.installment_number`,
    [cardId],
  );
  return rows.map(row => ({
    id: row.id,
    purchaseId: row.purchase_id ?? '',
    installmentNumber: row.installment_number ?? 1,
    totalInstallments: row.total_installments ?? 1,
    amount: row.amount ?? 0,
    billIdOverride: row.bill_id_override,
    transactionId: row.transaction_id,
    providerTransactionId: row.provider_transaction_id,
    status: (row.status ?? 'projected') as InstallmentStatus,
  }));
}

export async function createPurchase(input: {
  cardId: string;
  purchaseDate: string;
  merchant?: string | null;
  description?: string | null;
  totalAmount: number;
  installmentCount: number;
  categoryId?: string | null;
  source?: string;
  providerPurchaseKey?: string | null;
}): Promise<StoredPurchase> {
  const count = input.installmentCount;
  const parts = splitInstallments(input.totalAmount, count);
  const id = await db.insertWithUUID('credit_card_purchases', {
    card_id: input.cardId,
    purchase_date: input.purchaseDate,
    merchant: input.merchant ?? null,
    description: input.description ?? null,
    total_amount: input.totalAmount,
    installment_count: count,
    category_id: input.categoryId ?? null,
    provider_purchase_key: input.providerPurchaseKey ?? null,
    source: input.source ?? 'manual',
    status: 'open',
    tombstone: 0,
  });
  for (let index = 0; index < parts.length; index++) {
    const number = index + 1;
    await db.insertWithUUID('credit_card_installments', {
      id: installmentId(id, number),
      purchase_id: id,
      card_id: input.cardId,
      installment_number: number,
      total_installments: count,
      amount: parts[index],
      bill_id_override: null,
      transaction_id: null,
      provider_transaction_id: null,
      status: 'projected',
      tombstone: 0,
    });
  }
  return {
    id,
    cardId: input.cardId,
    purchaseDate: input.purchaseDate,
    merchant: input.merchant ?? null,
    description: input.description ?? null,
    totalAmount: input.totalAmount,
    installmentCount: count,
    categoryId: input.categoryId ?? null,
    providerPurchaseKey: input.providerPurchaseKey ?? null,
    source: input.source ?? 'manual',
    status: 'open',
  };
}

export function installmentDate(
  purchaseDate: string,
  installmentNumber: number,
): string {
  return addCalendarMonths(purchaseDate, installmentNumber - 1);
}

export async function findPurchase(id: string): Promise<StoredPurchase | null> {
  const row = await db.first<{ card_id: string | null }>(
    'SELECT card_id FROM credit_card_purchases WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!row?.card_id) {
    return null;
  }
  const purchases = await listPurchases(row.card_id);
  return purchases.find(purchase => purchase.id === id) ?? null;
}

export async function deletePurchase(id: string): Promise<void> {
  const installments = await db.all<{ id: string }>(
    'SELECT id FROM credit_card_installments WHERE purchase_id = ? AND tombstone = 0',
    [id],
  );
  for (const installment of installments) {
    await db.delete_('credit_card_installments', installment.id);
  }
  await db.delete_('credit_card_purchases', id);
}

export async function listLinks(cardId: string): Promise<StoredLink[]> {
  const rows = await db.all<{
    id: string;
    transaction_id: string | null;
    card_id: string | null;
    bill_id: string | null;
    kind: string | null;
    source: string | null;
  }>(
    'SELECT * FROM credit_card_transaction_links WHERE card_id = ? AND tombstone = 0',
    [cardId],
  );
  return rows.map(row => ({
    id: row.id,
    transactionId: row.transaction_id ?? '',
    cardId: row.card_id ?? '',
    billId: row.bill_id ?? '',
    kind: (row.kind ?? 'purchase') as ChargeKind,
    source: row.source ?? 'manual',
  }));
}

export async function upsertLink(link: StoredLink): Promise<void> {
  const fields = {
    id: link.transactionId,
    transaction_id: link.transactionId,
    card_id: link.cardId,
    bill_id: link.billId,
    kind: link.kind,
    source: link.source,
    tombstone: 0,
  };
  const existing = await db.first<{ id: string }>(
    'SELECT id FROM credit_card_transaction_links WHERE id = ?',
    [link.transactionId],
  );
  if (existing) {
    await db.update('credit_card_transaction_links', fields);
    return;
  }
  await db.insertWithUUID('credit_card_transaction_links', fields);
}

export async function listPayments(cardId: string): Promise<StoredPayment[]> {
  const rows = await db.all<{
    id: string;
    card_id: string | null;
    bill_id: string | null;
    transaction_id: string | null;
    bank_transaction_id: string | null;
    amount: number | null;
    payment_date: string | null;
    source: string | null;
    status: string | null;
  }>('SELECT * FROM credit_card_payments WHERE card_id = ? AND tombstone = 0', [
    cardId,
  ]);
  return rows.map(row => ({
    id: row.id,
    cardId: row.card_id ?? '',
    billId: row.bill_id ?? '',
    transactionId: row.transaction_id,
    bankTransactionId: row.bank_transaction_id,
    amount: row.amount ?? 0,
    paymentDate: row.payment_date ?? '',
    source: row.source ?? 'manual',
    status: row.status ?? 'confirmed',
  }));
}

export async function upsertPayment(payment: StoredPayment): Promise<void> {
  const fields = {
    id: payment.id,
    card_id: payment.cardId,
    bill_id: payment.billId,
    transaction_id: payment.transactionId,
    bank_transaction_id: payment.bankTransactionId,
    amount: payment.amount,
    payment_date: payment.paymentDate,
    source: payment.source,
    status: payment.status,
    tombstone: 0,
  };
  const existing = await db.first<{ id: string }>(
    'SELECT id FROM credit_card_payments WHERE id = ?',
    [payment.id],
  );
  if (existing) {
    await db.update('credit_card_payments', fields);
    return;
  }
  await db.insertWithUUID('credit_card_payments', fields);
}

export async function deletePayment(id: string): Promise<void> {
  await db.delete_('credit_card_payments', id);
}

export async function listCardTransactions(
  accountId: string,
): Promise<CardTransaction[]> {
  const rows = await db.all<{
    id: string;
    date: number | null;
    amount: number | null;
    notes: string | null;
    payee_name: string | null;
    transfer_id: string | null;
    raw_synced_data: string | null;
    starting_balance_flag: number | null;
    is_parent: number | null;
  }>(
    `SELECT t.id, t.date, t.amount, t.notes, t.transfer_id,
            t.starting_balance_flag, t.is_parent, tx.raw_synced_data,
            p.name AS payee_name
     FROM v_transactions_internal_alive t
     LEFT JOIN transactions tx ON tx.id = t.id
     LEFT JOIN payees p ON p.id = t.payee
     WHERE t.account = ?`,
    [accountId],
  );
  return rows.map(row => ({
    id: row.id,
    date: row.date == null ? '' : fromDateRepr(row.date),
    amount: row.amount ?? 0,
    notes: row.notes,
    payeeName: row.payee_name,
    transferId: row.transfer_id,
    rawSyncedData: row.raw_synced_data,
    startingBalance: row.starting_balance_flag === 1,
    isParent: row.is_parent === 1,
  }));
}

export async function getCardTransaction(
  accountId: string,
  transactionId: string,
): Promise<CardTransaction | null> {
  const transactions = await listCardTransactions(accountId);
  return (
    transactions.find(transaction => transaction.id === transactionId) ?? null
  );
}

export type ImportRecord = {
  id: string;
  provider: string;
  entityType: string;
  externalId: string;
  fingerprint: string | null;
  localEntityId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  payloadHash: string | null;
};

export async function upsertImportRecord(record: ImportRecord): Promise<void> {
  const existing = await db.first<{ first_seen_at: string | null }>(
    'SELECT first_seen_at FROM credit_card_import_records WHERE id = ?',
    [record.id],
  );
  const fields = {
    id: record.id,
    provider: record.provider,
    entity_type: record.entityType,
    external_id: record.externalId,
    fingerprint: record.fingerprint,
    local_entity_id: record.localEntityId,
    first_seen_at: existing?.first_seen_at ?? record.firstSeenAt,
    last_seen_at: record.lastSeenAt,
    payload_hash: record.payloadHash,
    tombstone: 0,
  };
  if (existing) {
    await db.update('credit_card_import_records', fields);
    return;
  }
  await db.insertWithUUID('credit_card_import_records', fields);
}

export type ReviewItem = {
  id: string;
  cardId: string;
  kind: string;
  subjectId: string | null;
  candidates: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
};

export async function listReviewItems(cardId: string): Promise<ReviewItem[]> {
  const rows = await db.all<{
    id: string;
    card_id: string | null;
    kind: string | null;
    subject_id: string | null;
    candidates: string | null;
    status: string | null;
    resolution: string | null;
    created_at: string | null;
  }>(
    'SELECT * FROM credit_card_review_items WHERE card_id = ? AND tombstone = 0 ORDER BY created_at',
    [cardId],
  );
  return rows.map(row => ({
    id: row.id,
    cardId: row.card_id ?? '',
    kind: row.kind ?? '',
    subjectId: row.subject_id,
    candidates: row.candidates,
    status: row.status ?? 'open',
    resolution: row.resolution,
    createdAt: row.created_at ?? '',
  }));
}

export async function insertReviewItem(item: {
  cardId: string;
  kind: string;
  subjectId?: string | null;
  candidates?: string | null;
  createdAt: string;
}): Promise<string> {
  return db.insertWithUUID('credit_card_review_items', {
    card_id: item.cardId,
    kind: item.kind,
    subject_id: item.subjectId ?? null,
    candidates: item.candidates ?? null,
    status: 'open',
    resolution: null,
    created_at: item.createdAt,
    tombstone: 0,
  });
}

export async function resolveReviewItem(
  id: string,
  resolution: string,
): Promise<boolean> {
  const existing = await db.first<{ id: string }>(
    'SELECT id FROM credit_card_review_items WHERE id = ? AND tombstone = 0',
    [id],
  );
  if (!existing) {
    return false;
  }
  await db.update('credit_card_review_items', {
    id,
    status: 'resolved',
    resolution,
  });
  return true;
}
