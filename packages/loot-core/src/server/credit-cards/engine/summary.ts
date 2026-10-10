import type { BillView, CardSummary, Cents } from './types';

/**
 * What a bill still commits the cardholder to. A bank-confirmed total wins
 * over the projection; a bill the bank has not confirmed uses the projection,
 * which includes installments that have not been imported yet.
 */
export function billCommitment(bill: BillView): Cents {
  const base =
    bill.confirmedTotal == null ? bill.projectedTotal : bill.confirmedTotal;
  return base - bill.amountPaid;
}

export function summarize(
  bills: BillView[],
  today: string,
  account: {
    accountBalance: Cents;
    creditLimit: Cents | null;
    availableLimit: Cents | null;
  },
): CardSummary {
  const active = bills
    .filter(bill => bill.status !== 'cancelled')
    .slice()
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate));

  const closed = active.filter(bill => bill.closingDate <= today);
  const statement =
    closed.length > 0 ? closed[closed.length - 1] : (active[0] ?? null);

  const openBill =
    active.find(
      bill =>
        today >= bill.cycleStart &&
        today <= bill.cycleEnd &&
        today <= bill.closingDate,
    ) ?? null;

  const future = statement
    ? active.filter(bill => bill.closingDate > statement.closingDate)
    : [];
  const futureCommitments = future.reduce(
    (total, bill) => total + billCommitment(bill),
    0,
  );
  const amountDue = statement?.remaining ?? 0;

  return {
    statement,
    openBill,
    currentBillAmount: statement?.amountOwed ?? 0,
    amountDue,
    amountPaid: statement?.amountPaid ?? 0,
    futureCommitments,
    totalCommitment: amountDue + futureCommitments,
    accountBalance: account.accountBalance,
    creditLimit: account.creditLimit,
    availableLimit: account.availableLimit,
  };
}
