import { clampDay } from '#server/credit-cards/engine/bill-calendar';
import type { DateString } from '#server/credit-cards/engine/types';
import type { ProviderCardSnapshot } from '#server/credit-cards/snapshot';
import { addDays, addMonths } from '#shared/months';
import { integerToAmount } from '#shared/util';

import type { CardStatement, StatementEntry } from './types';

/**
 * A statement entry in the shape bank sync downloads transactions, so the
 * import goes through the same matching and card rules as a Pluggy card.
 * The `creditCardMetadata.*` keys are what `provider-facts.ts` reads back.
 */
export type StatementRow = {
  transactionId: string;
  booked: true;
  date: DateString;
  payeeName: string;
  notes: string;
  amount: number;
  transactionAmount: { amount: number; currency: string };
  description: string;
  operationType: string | null;
  'creditCardMetadata.billId': string | null;
  'creditCardMetadata.purchaseDate': DateString | null;
  'creditCardMetadata.installmentNumber': number | null;
  'creditCardMetadata.totalInstallments': number | null;
  'creditCardMetadata.totalAmount': number | null;
  'creditCardMetadata.cardNumber': string | null;
};

export function statementBillId(statement: CardStatement) {
  return `statement:${statement.issuer}:${statement.dueDate}`;
}

/** First day whose charges belong to the statement's bill. */
export function statementCycleStart(statement: CardStatement): DateString {
  const month = addMonths(statement.closingDate.slice(0, 7), -1);
  return addDays(clampDay(month, Number(statement.closingDate.slice(8))), 1);
}

/**
 * The day an entry is charged on. An installment of an older purchase is
 * printed with the purchase date; it is charged the same day of the month,
 * the installment number of months later, within this bill's cycle.
 */
export function postingDate(
  entry: StatementEntry,
  statement: CardStatement,
): DateString {
  const start = statementCycleStart(statement);
  if (!entry.installment || entry.date >= start) {
    return entry.date;
  }
  const shifted = clampDay(
    addMonths(entry.date.slice(0, 7), entry.installment.number - 1),
    Number(entry.date.slice(8)),
  );
  if (shifted < start) {
    return start;
  }
  return shifted > statement.closingDate ? statement.closingDate : shifted;
}

function isOlderPurchase(entry: StatementEntry, statement: CardStatement) {
  return (
    entry.installment != null && entry.date < statementCycleStart(statement)
  );
}

export function toStatementRows(statement: CardStatement): StatementRow[] {
  const billId = statementBillId(statement);
  const seen = new Map<string, number>();
  return statement.entries.map(entry => {
    const date = postingDate(entry, statement);
    // Two identical lines on one bill are told apart by their order.
    const key = `${date}:${entry.amount}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);

    const description = [entry.description, entry.merchant]
      .filter(Boolean)
      .join(' ');
    const amount = integerToAmount(entry.amount);
    return {
      transactionId: `${billId}:${key}:${occurrence}`,
      booked: true,
      date,
      payeeName: entry.merchant ?? entry.description,
      notes: entry.description,
      amount,
      transactionAmount: { amount, currency: 'BRL' },
      description,
      operationType: entry.isPayment ? 'PAGAMENTO_FATURA' : null,
      // A payment pays the bill before it; the card rules place it by date.
      'creditCardMetadata.billId': entry.isPayment ? null : billId,
      'creditCardMetadata.purchaseDate': isOlderPurchase(entry, statement)
        ? entry.date
        : null,
      'creditCardMetadata.installmentNumber': entry.installment?.number ?? null,
      'creditCardMetadata.totalInstallments': entry.installment?.count ?? null,
      'creditCardMetadata.totalAmount':
        entry.purchaseTotal == null
          ? null
          : integerToAmount(Math.abs(entry.purchaseTotal)),
      'creditCardMetadata.cardNumber': statement.cardLast4,
    };
  });
}

/** The statement as the card data bank sync sends next to transactions. */
export function toCardSnapshot(statement: CardStatement): ProviderCardSnapshot {
  const money = (cents: number | null) =>
    cents == null ? null : integerToAmount(cents);
  return {
    connector: 'statement',
    creditLimit: money(statement.creditLimit),
    availableCreditLimit: money(statement.availableLimit),
    balanceCloseDate: statement.closingDate,
    balanceDueDate: statement.dueDate,
    minimumPayment: money(statement.minimumPayment),
    brand: null,
    status: null,
    holderType: null,
    bills: [
      {
        id: statementBillId(statement),
        dueDate: statement.dueDate,
        closingDate: statement.closingDate,
        totalAmount: integerToAmount(statement.total),
        minimumPaymentAmount: money(statement.minimumPayment),
        financeCharges: [],
        payments: [],
      },
    ],
  };
}
