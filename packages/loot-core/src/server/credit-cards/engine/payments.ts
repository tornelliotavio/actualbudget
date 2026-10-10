import type {
  AllocationResult,
  BillView,
  Cents,
  PaymentAllocation,
} from './types';

export type PayableBill = {
  id: string;
  dueDate: string;
  remaining: Cents;
};

/**
 * Apply a payment to one bill, then to later unpaid bills with whatever is
 * left. Does not create a transaction. `unallocated` is the part that matched
 * no bill; the caller asks the user rather than inventing one.
 */
export function allocatePayment(
  amount: Cents,
  bills: PayableBill[],
  targetBillId?: string,
): AllocationResult {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('payment amount must be zero or a positive integer');
  }
  const ordered = bills
    .filter(bill => bill.remaining > 0)
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  let start = 0;
  if (targetBillId) {
    const index = ordered.findIndex(bill => bill.id === targetBillId);
    if (index === -1) {
      return { allocations: [], unallocated: amount };
    }
    start = index;
  }

  const allocations: PaymentAllocation[] = [];
  let left = amount;
  for (let index = start; index < ordered.length; index++) {
    if (left <= 0) {
      break;
    }
    const bill = ordered[index];
    const applied = Math.min(left, bill.remaining);
    if (applied > 0) {
      allocations.push({ billId: bill.id, amount: applied });
      left -= applied;
    }
  }
  return { allocations, unallocated: left };
}

/**
 * Unpaid remainder of a bill that has already closed. Open bills have not
 * been issued yet, so they do not revolve.
 */
export function carryoverAmount(bill: BillView): Cents {
  if (
    bill.status === 'cancelled' ||
    bill.status === 'paid' ||
    bill.status === 'open'
  ) {
    return 0;
  }
  return Math.max(0, bill.remaining);
}
