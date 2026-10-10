import { createApp } from '#server/app';
import { mutator } from '#server/mutators';
import { undoable } from '#server/undo';

import {
  deleteCreditCard,
  getCreditCardRow,
  insertCreditCard,
  listCreditCardRows,
  updateCreditCard,
} from './cards';
import type { CreditCard, CreditCardDraft } from './cards';
import {
  addCalendarMonths,
  billId,
  importRecordId,
  parseInstallmentLabel,
  upcomingCycles,
} from './engine';
import type { ChargeKind, Cycle, CycleConfig } from './engine';
import { getPluggyAiBills } from './pluggy-bills';
import { syncPluggyCard } from './pluggy-sync';
import { isProjectionError, projectCard } from './project';
import type { CardProjection } from './project';
import { reconcileCard } from './reconcile';
import {
  createPurchase,
  deletePayment,
  deletePurchase,
  findPurchase,
  getCardTransaction,
  insertReviewItem,
  listCardTransactions,
  listPayments,
  listReviewItems,
  resolveReviewItem,
  upsertImportRecord,
  upsertLink,
  upsertPayment,
  upsertStoredBill,
} from './records';
import type { StoredBill, StoredPurchase } from './records';
import {
  assertCreditCardsWritable,
  CREDIT_CARDS_SCHEMA_VERSION,
  creditCardsAccess,
} from './schema-version';

type HandlerError = { error: string };

export type CreditCardsHandlers = {
  'credit-cards-list': typeof listCards;
  'credit-cards-get': typeof getCard;
  'credit-cards-create': typeof createCard;
  'credit-cards-update': typeof updateCard;
  'credit-cards-delete': typeof removeCard;
  'credit-cards-meta': typeof meta;
  'credit-cards-summary': typeof summary;
  'credit-cards-bills': typeof bills;
  'credit-cards-bill': typeof bill;
  'credit-cards-purchases': typeof purchases;
  'credit-cards-create-purchase': typeof addPurchase;
  'credit-cards-delete-purchase': typeof removePurchase;
  'credit-cards-confirm-bill': typeof confirmBill;
  'credit-cards-allocate-payment': typeof allocatePayment;
  'credit-cards-unlink-payment': typeof unlinkPayment;
  'credit-cards-link-transaction': typeof linkTransaction;
  'credit-cards-reviews': typeof reviews;
  'credit-cards-add-review': typeof addReview;
  'credit-cards-resolve-review': typeof resolveReview;
  'credit-cards-import-record': typeof rememberImport;
  'credit-cards-projection': typeof projection;
  'credit-cards-transactions': typeof transactions;
  'credit-cards-assign-transactions': typeof assignTransactions;
  'credit-cards-sync-pluggy': typeof syncPluggy;
  'credit-cards-reconcile': typeof reconcile;
  'pluggyai-bills': typeof getPluggyAiBills;
};

async function listCards(): Promise<CreditCard[]> {
  return listCreditCardRows();
}

async function getCard({
  id,
}: {
  id: string;
}): Promise<CreditCard | HandlerError> {
  const card = await getCreditCardRow(id);
  if (!card) {
    return { error: 'not-found' };
  }
  return card;
}

async function createCard(
  draft: CreditCardDraft,
): Promise<CreditCard | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  return insertCreditCard(draft);
}

async function updateCard({
  id,
  ...patch
}: { id: string } & Partial<CreditCardDraft>): Promise<
  CreditCard | HandlerError
> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  return updateCreditCard(id, patch);
}

async function removeCard({
  id,
}: {
  id: string;
}): Promise<{ id: string } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  return deleteCreditCard(id);
}

async function meta(): Promise<{
  schemaVersion: number;
  supportedVersion: number;
  readOnly: boolean;
}> {
  const access = await creditCardsAccess();
  return {
    ...access,
    supportedVersion: CREDIT_CARDS_SCHEMA_VERSION,
  };
}

async function loadProjection(
  cardId: string,
  today?: string,
): Promise<CardProjection | HandlerError> {
  const projection = await projectCard(cardId, today);
  if (isProjectionError(projection)) {
    return projection;
  }
  return projection;
}

async function summary({
  cardId,
  today,
}: {
  cardId: string;
  today?: string;
}): Promise<CardProjection['summary'] | HandlerError> {
  const projection = await loadProjection(cardId, today);
  if ('error' in projection) {
    return projection;
  }
  return projection.summary;
}

async function bills({
  cardId,
  today,
}: {
  cardId: string;
  today?: string;
}): Promise<CardProjection['bills'] | HandlerError> {
  const projection = await loadProjection(cardId, today);
  if ('error' in projection) {
    return projection;
  }
  return projection.bills;
}

async function bill({
  cardId,
  billId: id,
  today,
}: {
  cardId: string;
  billId: string;
  today?: string;
}): Promise<
  | {
      bill: CardProjection['bills'][number];
      lines: CardProjection['lines'][string];
    }
  | HandlerError
> {
  const projection = await loadProjection(cardId, today);
  if ('error' in projection) {
    return projection;
  }
  const found = projection.bills.find(item => item.id === id);
  if (!found) {
    return { error: 'not-found' };
  }
  return { bill: found, lines: projection.lines[id] ?? [] };
}

async function purchases({ cardId }: { cardId: string }): Promise<
  | {
      purchases: CardProjection['purchases'];
      installments: CardProjection['installments'];
    }
  | HandlerError
> {
  const projection = await loadProjection(cardId);
  if ('error' in projection) {
    return projection;
  }
  return {
    purchases: projection.purchases,
    installments: projection.installments,
  };
}

async function addPurchase(input: {
  cardId: string;
  purchaseDate: string;
  merchant?: string | null;
  description?: string | null;
  totalAmount: number;
  installmentCount: number;
  categoryId?: string | null;
}): Promise<StoredPurchase | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const card = await getCreditCardRow(input.cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate)) {
    return { error: 'invalid-date' };
  }
  if (!Number.isInteger(input.totalAmount)) {
    return { error: 'invalid-amount' };
  }
  if (
    !Number.isInteger(input.installmentCount) ||
    input.installmentCount < 1 ||
    input.installmentCount > 48
  ) {
    return { error: 'invalid-installments' };
  }
  return createPurchase({ ...input, source: 'manual' });
}

async function removePurchase({
  id,
}: {
  id: string;
}): Promise<{ id: string } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const purchase = await findPurchase(id);
  if (!purchase) {
    return { error: 'not-found' };
  }
  await deletePurchase(id);
  return { id };
}

function cycleForMonth(
  referenceMonth: string,
  config: CycleConfig,
): Cycle | null {
  const from = addCalendarMonths(`${referenceMonth}-01`, -2);
  return (
    upcomingCycles(from, 8, config).find(
      cycle => cycle.referenceMonth === referenceMonth,
    ) ?? null
  );
}

async function confirmBill(input: {
  cardId: string;
  referenceMonth: string;
  confirmedTotal: number;
  minimumPayment?: number | null;
  providerBillId?: string | null;
  source?: string;
  cancelled?: boolean;
}): Promise<StoredBill | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const card = await getCreditCardRow(input.cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  if (!Number.isInteger(input.confirmedTotal) || input.confirmedTotal < 0) {
    return { error: 'invalid-amount' };
  }
  const cycle = cycleForMonth(input.referenceMonth, {
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    closingDayPolicy: card.closingDayPolicy,
  });
  if (!cycle) {
    return { error: 'invalid-month' };
  }
  const stored: StoredBill = {
    id: billId(card.id, cycle.referenceMonth),
    cardId: card.id,
    referenceMonth: cycle.referenceMonth,
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    closingDate: cycle.closingDate,
    dueDate: cycle.dueDate,
    confirmedTotal: input.confirmedTotal,
    minimumPayment: input.minimumPayment ?? null,
    source: input.source ?? 'manual',
    providerBillId: input.providerBillId ?? null,
    lastConfirmedAt: new Date(Date.now()).toISOString(),
    cancelled: input.cancelled ?? false,
  };
  await upsertStoredBill(stored);
  return stored;
}

async function allocatePayment(input: {
  cardId: string;
  billId: string;
  transactionId: string;
  amount?: number;
  bankTransactionId?: string | null;
}): Promise<{ id: string; amount: number } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const card = await getCreditCardRow(input.cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  if (!input.billId.endsWith(`:${input.billId.slice(-7)}`)) {
    return { error: 'invalid-bill' };
  }
  const transaction = await getCardTransaction(
    card.accountId,
    input.transactionId,
  );
  if (!transaction || transaction.amount <= 0) {
    return { error: 'not-a-payment' };
  }
  const amount = input.amount ?? transaction.amount;
  if (!Number.isInteger(amount) || amount <= 0 || amount > transaction.amount) {
    return { error: 'invalid-amount' };
  }
  const paymentId = `${input.transactionId}:${input.billId}`;
  const existing = await listPayments(card.id);
  const already = existing
    .filter(
      payment =>
        payment.transactionId === input.transactionId &&
        payment.id !== paymentId,
    )
    .reduce((total, payment) => total + payment.amount, 0);
  if (already + amount > transaction.amount) {
    return { error: 'over-allocated' };
  }
  await upsertPayment({
    id: paymentId,
    cardId: card.id,
    billId: input.billId,
    transactionId: input.transactionId,
    bankTransactionId: input.bankTransactionId ?? null,
    amount,
    paymentDate: transaction.date,
    source: 'manual',
    status: 'confirmed',
  });
  return { id: paymentId, amount };
}

async function unlinkPayment({
  id,
}: {
  id: string;
}): Promise<{ id: string } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  await deletePayment(id);
  return { id };
}

async function linkTransaction(input: {
  cardId: string;
  transactionId: string;
  billId: string;
  kind?: ChargeKind;
}): Promise<{ id: string } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const card = await getCreditCardRow(input.cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  const transaction = await getCardTransaction(
    card.accountId,
    input.transactionId,
  );
  if (!transaction) {
    return { error: 'not-found' };
  }
  await upsertLink({
    id: input.transactionId,
    transactionId: input.transactionId,
    cardId: card.id,
    billId: input.billId,
    kind: input.kind ?? 'purchase',
    source: 'manual',
  });
  return { id: input.transactionId };
}

async function reviews({ cardId }: { cardId: string }) {
  return listReviewItems(cardId);
}

async function addReview(input: {
  cardId: string;
  kind: string;
  subjectId?: string | null;
  candidates?: string | null;
}): Promise<{ id: string } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const card = await getCreditCardRow(input.cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  const id = await insertReviewItem({
    ...input,
    createdAt: new Date(Date.now()).toISOString(),
  });
  return { id };
}

async function resolveReview(input: {
  id: string;
  resolution: string;
}): Promise<{ id: string } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const resolved = await resolveReviewItem(input.id, input.resolution);
  if (!resolved) {
    return { error: 'not-found' };
  }
  return { id: input.id };
}

async function rememberImport(input: {
  provider: string;
  entityType: string;
  externalId: string;
  localEntityId?: string | null;
  payloadHash?: string | null;
}): Promise<{ id: string } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const now = new Date(Date.now()).toISOString();
  const id = importRecordId(input.provider, input.entityType, input.externalId);
  await upsertImportRecord({
    id,
    provider: input.provider,
    entityType: input.entityType,
    externalId: input.externalId,
    fingerprint: id,
    localEntityId: input.localEntityId ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
    payloadHash: input.payloadHash ?? null,
  });
  return { id };
}

async function projection({
  cardId,
  today,
}: {
  cardId: string;
  today?: string;
}): Promise<CardProjection | HandlerError> {
  return loadProjection(cardId, today);
}

async function transactions({ cardId }: { cardId: string }): Promise<
  | Array<{
      id: string;
      date: string;
      amount: number;
      notes: string | null;
      payeeName: string | null;
      transferId: string | null;
    }>
  | HandlerError
> {
  const card = await getCreditCardRow(cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  const rows = await listCardTransactions(card.accountId);
  return rows
    .filter(row => !row.isParent && !row.startingBalance)
    .map(row => ({
      id: row.id,
      date: row.date,
      amount: row.amount,
      notes: row.notes,
      payeeName: row.payeeName,
      transferId: row.transferId,
    }));
}

async function assignTransactions(input: {
  cardId: string;
  billId: string;
  transactionIds: string[];
}): Promise<
  | {
      assigned: Array<{
        id: string;
        kind: ChargeKind;
        installmentNumber: number | null;
        totalInstallments: number | null;
      }>;
    }
  | HandlerError
> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  const card = await getCreditCardRow(input.cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  const assigned: Array<{
    id: string;
    kind: ChargeKind;
    installmentNumber: number | null;
    totalInstallments: number | null;
  }> = [];
  for (const transactionId of input.transactionIds) {
    const transaction = await getCardTransaction(card.accountId, transactionId);
    if (!transaction || transaction.transferId) {
      continue;
    }
    const label = parseInstallmentLabel(
      `${transaction.payeeName ?? ''} ${transaction.notes ?? ''}`,
    );
    let kind: ChargeKind = 'purchase';
    if (label) {
      kind = 'installment';
    } else if (transaction.amount > 0) {
      kind = 'refund';
    }
    await upsertLink({
      id: transaction.id,
      transactionId: transaction.id,
      cardId: card.id,
      billId: input.billId,
      kind,
      source: 'manual',
    });
    assigned.push({
      id: transaction.id,
      kind,
      installmentNumber: label?.number ?? null,
      totalInstallments: label?.total ?? null,
    });
  }
  return { assigned };
}

async function reconcile({
  cardId,
  today,
}: {
  cardId: string;
  today?: string;
}) {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  return reconcileCard(cardId, today);
}

async function syncPluggy({
  cardId,
}: {
  cardId: string;
}): Promise<{ bills: number; limitsUpdated: boolean } | HandlerError> {
  const blocked = await assertCreditCardsWritable();
  if (blocked) {
    return blocked;
  }
  return syncPluggyCard(cardId);
}

export const app = createApp<CreditCardsHandlers>();
app.method('credit-cards-list', listCards);
app.method('credit-cards-get', getCard);
app.method('credit-cards-create', mutator(undoable(createCard)));
app.method('credit-cards-update', mutator(undoable(updateCard)));
app.method('credit-cards-delete', mutator(undoable(removeCard)));
app.method('credit-cards-meta', meta);
app.method('credit-cards-summary', summary);
app.method('credit-cards-bills', bills);
app.method('credit-cards-bill', bill);
app.method('credit-cards-purchases', purchases);
app.method('credit-cards-create-purchase', mutator(undoable(addPurchase)));
app.method('credit-cards-delete-purchase', mutator(undoable(removePurchase)));
app.method('credit-cards-confirm-bill', mutator(undoable(confirmBill)));
app.method('credit-cards-allocate-payment', mutator(undoable(allocatePayment)));
app.method('credit-cards-unlink-payment', mutator(undoable(unlinkPayment)));
app.method('credit-cards-link-transaction', mutator(undoable(linkTransaction)));
app.method('credit-cards-reviews', reviews);
app.method('credit-cards-add-review', mutator(undoable(addReview)));
app.method('credit-cards-resolve-review', mutator(undoable(resolveReview)));
app.method('credit-cards-import-record', mutator(undoable(rememberImport)));
app.method('credit-cards-projection', projection);
app.method('credit-cards-transactions', transactions);
app.method(
  'credit-cards-assign-transactions',
  mutator(undoable(assignTransactions)),
);
app.method('credit-cards-sync-pluggy', mutator(undoable(syncPluggy)));
app.method('credit-cards-reconcile', mutator(undoable(reconcile)));
app.method('pluggyai-bills', getPluggyAiBills);
