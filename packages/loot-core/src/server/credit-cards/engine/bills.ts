import type { BillInput, BillStatus, BillView, Cents } from './types';

function sum(values: Cents[]): Cents {
  return values.reduce((total, value) => total + value, 0);
}

export function billStatus(
  bill: Pick<
    BillView,
    | 'cancelled'
    | 'closingDate'
    | 'dueDate'
    | 'amountOwed'
    | 'amountPaid'
    | 'remaining'
  >,
  today: string,
): BillStatus {
  if (bill.cancelled) {
    return 'cancelled';
  }
  if (bill.remaining <= 0 && bill.amountPaid > 0) {
    return 'paid';
  }
  if (
    bill.remaining <= 0 &&
    bill.amountOwed === 0 &&
    today > bill.closingDate
  ) {
    return 'paid';
  }
  if (today > bill.dueDate && bill.remaining > 0) {
    return 'overdue';
  }
  if (bill.amountPaid > 0 && bill.remaining > 0) {
    return 'partially_paid';
  }
  if (today <= bill.closingDate) {
    return 'open';
  }
  return 'closed';
}

export function computeBill(input: BillInput, today: string): BillView {
  const computedTotal = sum(
    input.charges
      .filter(charge => !charge.projected)
      .map(charge => charge.owedAmount),
  );
  const projectedExtra = sum(
    input.charges
      .filter(charge => charge.projected)
      .map(charge => charge.owedAmount),
  );
  const projectedTotal = computedTotal + projectedExtra;
  const amountOwed =
    input.confirmedTotal == null ? computedTotal : input.confirmedTotal;
  const amountPaid = sum(input.payments.map(payment => payment.amount));
  const remaining = amountOwed - amountPaid;
  const divergence =
    input.confirmedTotal == null ? null : input.confirmedTotal - computedTotal;
  const view: BillView = {
    id: input.id,
    referenceMonth: input.referenceMonth,
    cycleStart: input.cycleStart,
    cycleEnd: input.cycleEnd,
    closingDate: input.closingDate,
    dueDate: input.dueDate,
    confirmedTotal: input.confirmedTotal,
    minimumPayment: input.minimumPayment,
    cancelled: input.cancelled,
    computedTotal,
    projectedTotal,
    amountOwed,
    amountPaid,
    remaining,
    divergence,
    status: 'open',
  };
  view.status = billStatus(view, today);
  return view;
}
