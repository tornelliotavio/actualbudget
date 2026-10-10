import { currentDay } from '#shared/months';

import { getCreditCardRow } from './cards';
import type { CreditCard } from './cards';
import {
  addCalendarMonths,
  assignTransaction,
  billId,
  computeBill,
  owedFromActual,
  readCardMetadata,
  resolveCycle,
  summarize,
  upcomingCycles,
} from './engine';
import type {
  BillCharge,
  BillInput,
  BillPayment,
  BillView,
  CardSummary,
  ChargeKind,
  Cycle,
  CycleConfig,
  CycleOverride,
  DataSource,
} from './engine';
import {
  installmentDate,
  listCardTransactions,
  listInstallments,
  listLinks,
  listPayments,
  listPurchases,
  listStoredBills,
} from './records';
import type {
  CardTransaction,
  StoredBill,
  StoredInstallment,
  StoredPurchase,
} from './records';
import { creditCardsAccess } from './schema-version';

export type BillLine = {
  id: string;
  date: string;
  description: string;
  owedAmount: number;
  projected: boolean;
  kind: ChargeKind;
  source: DataSource;
};

export type UnlinkedPayment = {
  id: string;
  date: string;
  amount: number;
  payeeName: string | null;
};

export type CardProjection = {
  card: CreditCard;
  bills: BillView[];
  lines: Record<string, BillLine[]>;
  summary: CardSummary;
  purchases: StoredPurchase[];
  installments: StoredInstallment[];
  unlinkedPayments: UnlinkedPayment[];
  readOnly: boolean;
};

type Bucket = {
  cycle: Cycle;
  charges: BillCharge[];
  lines: BillLine[];
  payments: BillPayment[];
  stored: StoredBill | null;
};

function cycleConfig(card: CreditCard): CycleConfig {
  return {
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    closingDayPolicy: card.closingDayPolicy,
  };
}

function overridesFrom(bills: StoredBill[]): CycleOverride[] {
  return bills
    .filter(
      bill =>
        bill.cycleStart && bill.cycleEnd && bill.closingDate && bill.dueDate,
    )
    .map(bill => ({
      referenceMonth: bill.referenceMonth,
      cycleStart: bill.cycleStart,
      cycleEnd: bill.cycleEnd,
      closingDate: bill.closingDate,
      dueDate: bill.dueDate,
    }));
}

function descriptionOf(transaction: CardTransaction): string {
  return transaction.payeeName || transaction.notes || '';
}

export async function projectCard(
  cardId: string,
  today = currentDay(),
): Promise<CardProjection | { error: string }> {
  const card = await getCreditCardRow(cardId);
  if (!card) {
    return { error: 'not-found' };
  }
  const config = cycleConfig(card);
  const [
    storedBills,
    purchases,
    installments,
    links,
    payments,
    transactions,
    access,
  ] = await Promise.all([
    listStoredBills(cardId),
    listPurchases(cardId),
    listInstallments(cardId),
    listLinks(cardId),
    listPayments(cardId),
    listCardTransactions(card.accountId),
    creditCardsAccess(),
  ]);
  const overrides = overridesFrom(storedBills);
  const purchasesById = new Map(
    purchases.map(purchase => [purchase.id, purchase]),
  );
  const linkByTransaction = new Map(
    links.map(link => [link.transactionId, link]),
  );
  const paidTransactionIds = new Set(
    payments.map(payment => payment.transactionId).filter(id => id != null),
  );
  const installmentByTransaction = new Map(
    installments
      .filter(installment => installment.transactionId)
      .map(installment => [installment.transactionId as string, installment]),
  );

  const buckets = new Map<string, Bucket>();
  const ensure = (cycle: Cycle): Bucket => {
    const existing = buckets.get(cycle.referenceMonth);
    if (existing) {
      return existing;
    }
    const stored =
      storedBills.find(bill => bill.referenceMonth === cycle.referenceMonth) ??
      null;
    const bucket: Bucket = {
      cycle,
      charges: [],
      lines: [],
      payments: [],
      stored,
    };
    buckets.set(cycle.referenceMonth, bucket);
    return bucket;
  };

  const windowStart = addCalendarMonths(today, -18);
  for (const cycle of upcomingCycles(windowStart, 30, config, overrides)) {
    ensure(cycle);
  }
  for (const stored of storedBills) {
    if (
      !buckets.has(stored.referenceMonth) &&
      stored.closingDate &&
      stored.dueDate
    ) {
      ensure({
        referenceMonth: stored.referenceMonth,
        cycleStart: stored.cycleStart ?? stored.closingDate,
        cycleEnd: stored.cycleEnd ?? stored.closingDate,
        closingDate: stored.closingDate,
        dueDate: stored.dueDate,
      });
    }
  }

  const billRefs = [...buckets.values()].map(bucket => ({
    id: billId(card.id, bucket.cycle.referenceMonth),
    referenceMonth: bucket.cycle.referenceMonth,
    providerBillId: bucket.stored?.providerBillId,
  }));

  const unlinkedPayments: UnlinkedPayment[] = [];
  let accountBalance = 0;

  for (const transaction of transactions) {
    if (transaction.isParent) {
      continue;
    }
    accountBalance += transaction.amount;
    if (transaction.startingBalance || !transaction.date) {
      continue;
    }
    if (paidTransactionIds.has(transaction.id)) {
      continue;
    }
    const link = linkByTransaction.get(transaction.id);
    if (!link && transaction.transferId) {
      if (transaction.amount > 0) {
        unlinkedPayments.push({
          id: transaction.id,
          date: transaction.date,
          amount: transaction.amount,
          payeeName: transaction.payeeName,
        });
      }
      continue;
    }

    const metadata = readCardMetadata(transaction.rawSyncedData);
    const assignment = assignTransaction(
      {
        id: transaction.id,
        date: transaction.date,
        originalDate: metadata?.originalDate,
        amount: transaction.amount,
        notes: transaction.notes,
        payeeName: transaction.payeeName,
        isTransfer: false,
        metadata,
      },
      config,
      billRefs,
      {
        link: link ? { billId: link.billId, kind: link.kind } : null,
        overrides,
      },
    );
    if (assignment.kind === 'payment' || !assignment.referenceMonth) {
      continue;
    }
    const bucket = buckets.get(assignment.referenceMonth);
    if (!bucket) {
      continue;
    }
    const owedAmount = owedFromActual(transaction.amount);
    const linkedInstallment = installmentByTransaction.get(transaction.id);
    bucket.charges.push({
      id: transaction.id,
      owedAmount,
      projected: false,
      kind: assignment.kind,
    });
    bucket.lines.push({
      id: transaction.id,
      date: transaction.date,
      description: descriptionOf(transaction),
      owedAmount,
      projected: false,
      kind: linkedInstallment ? 'installment' : assignment.kind,
      source: metadata?.billId ? 'bank' : link ? 'manual' : 'imported',
    });
  }

  for (const installment of installments) {
    if (installment.transactionId || installment.status === 'cancelled') {
      continue;
    }
    if (installment.status === 'reversed') {
      continue;
    }
    const purchase = purchasesById.get(installment.purchaseId);
    if (!purchase) {
      continue;
    }
    const date = installmentDate(
      purchase.purchaseDate,
      installment.installmentNumber,
    );
    const cycle = installment.billIdOverride
      ? [...buckets.values()].find(
          bucket =>
            billId(card.id, bucket.cycle.referenceMonth) ===
            installment.billIdOverride,
        )?.cycle
      : resolveCycle(date, config, overrides);
    if (!cycle) {
      continue;
    }
    const bucket = ensure(cycle);
    bucket.charges.push({
      id: installment.id,
      owedAmount: installment.amount,
      projected: true,
      kind: 'installment',
    });
    bucket.lines.push({
      id: installment.id,
      date,
      description: purchase.merchant || purchase.description || '',
      owedAmount: installment.amount,
      projected: true,
      kind: 'installment',
      source: 'projected',
    });
  }

  for (const payment of payments) {
    const referenceMonth = payment.billId.split(':').slice(1).join(':');
    const bucket = buckets.get(referenceMonth);
    if (!bucket) {
      continue;
    }
    bucket.payments.push({
      id: payment.id,
      amount: payment.amount,
      date: payment.paymentDate,
    });
  }

  const lines: Record<string, BillLine[]> = {};
  const bills: BillView[] = [];
  for (const bucket of buckets.values()) {
    const hasContent =
      bucket.charges.length > 0 ||
      bucket.payments.length > 0 ||
      bucket.stored != null ||
      (today >= bucket.cycle.cycleStart && today <= bucket.cycle.cycleEnd);
    if (!hasContent) {
      continue;
    }
    const input: BillInput = {
      id: billId(card.id, bucket.cycle.referenceMonth),
      referenceMonth: bucket.cycle.referenceMonth,
      cycleStart: bucket.stored?.cycleStart ?? bucket.cycle.cycleStart,
      cycleEnd: bucket.stored?.cycleEnd ?? bucket.cycle.cycleEnd,
      closingDate: bucket.stored?.closingDate ?? bucket.cycle.closingDate,
      dueDate: bucket.stored?.dueDate ?? bucket.cycle.dueDate,
      confirmedTotal: bucket.stored?.confirmedTotal ?? null,
      minimumPayment: bucket.stored?.minimumPayment ?? null,
      cancelled: bucket.stored?.cancelled ?? false,
      charges: bucket.charges,
      payments: bucket.payments,
    };
    const view = computeBill(input, today);
    bills.push(view);
    lines[view.id] = bucket.lines;
  }
  bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    card,
    bills,
    lines,
    summary: summarize(bills, today, {
      accountBalance,
      creditLimit: card.creditLimit,
      availableLimit: card.availableLimit,
    }),
    purchases,
    installments,
    unlinkedPayments,
    readOnly: access.readOnly,
  };
}

export function isProjectionError(
  value: CardProjection | { error: string },
): value is { error: string } {
  return 'error' in value && !('card' in value);
}
