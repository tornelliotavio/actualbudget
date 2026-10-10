import { resolveCycle } from './cycles';
import type {
  AssignableTransaction,
  Assignment,
  ChargeKind,
  CycleConfig,
  CycleOverride,
} from './types';

export type BillRef = {
  id: string;
  referenceMonth: string;
  providerBillId?: string | null;
};

export type TransactionLink = {
  billId: string;
  kind: ChargeKind;
};

/**
 * Which bill a transaction belongs to. The first source that hits wins:
 * an explicit link, the provider bill id, the cycle of the original date,
 * then the cycle of Actual's (possibly shifted) date.
 */
export function assignTransaction(
  transaction: AssignableTransaction,
  config: CycleConfig,
  bills: BillRef[],
  options: {
    link?: TransactionLink | null;
    overrides?: CycleOverride[];
  } = {},
): Assignment {
  if (options.link) {
    const bill = bills.find(item => item.id === options.link?.billId);
    return {
      billId: options.link.billId,
      referenceMonth: bill?.referenceMonth ?? null,
      source: 'link',
      kind: options.link.kind,
    };
  }

  if (transaction.isTransfer) {
    return {
      billId: null,
      referenceMonth: null,
      source: 'unassigned',
      kind: 'payment',
    };
  }

  const providerBillId = transaction.metadata?.billId;
  if (providerBillId) {
    const bill = bills.find(item => item.providerBillId === providerBillId);
    if (bill) {
      return {
        billId: bill.id,
        referenceMonth: bill.referenceMonth,
        source: 'provider',
        kind: chargeKind(transaction),
      };
    }
  }

  const overrides = options.overrides ?? [];
  const originalDate =
    transaction.originalDate || transaction.metadata?.originalDate;
  if (originalDate) {
    const cycle = resolveCycle(originalDate, config, overrides);
    return {
      billId: billIdFor(cycle.referenceMonth, bills),
      referenceMonth: cycle.referenceMonth,
      source: 'original-date',
      kind: chargeKind(transaction),
    };
  }

  const resolved = resolveCycle(transaction.date, config, overrides);
  return {
    billId: billIdFor(resolved.referenceMonth, bills),
    referenceMonth: resolved.referenceMonth,
    source: 'date',
    kind: chargeKind(transaction),
  };
}

function billIdFor(referenceMonth: string, bills: BillRef[]): string | null {
  return bills.find(item => item.referenceMonth === referenceMonth)?.id ?? null;
}

function chargeKind(transaction: AssignableTransaction): ChargeKind {
  if (
    transaction.metadata?.installmentNumber != null &&
    (transaction.metadata.totalInstallments ?? 1) > 1
  ) {
    return 'installment';
  }
  if (transaction.amount > 0) {
    return 'refund';
  }
  return 'purchase';
}

/** Owed cents from an Actual amount. A purchase of -94825 contributes 94825. */
export function owedFromActual(amount: number): number {
  return -amount;
}
