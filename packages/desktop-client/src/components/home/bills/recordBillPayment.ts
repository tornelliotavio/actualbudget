import { send } from '@actual-app/core/platform/client/connection';
import type { PayeeEntity } from '@actual-app/core/types/models';
import { v4 as uuidv4 } from 'uuid';

import type { HomeBill } from './homeBills';

export type BillPayment = {
  /** Positive cents. */
  amount: number;
  date: string;
  accountId: string;
};

/**
 * Records a bill as paid, as the bank will later report it. A schedule's
 * bill posts the schedule's transaction, so it stays linked; a card no
 * schedule pays gets a transfer from the paying account. The payment is left
 * uncleared: when the bank sends it, bank sync matches it on the exact amount
 * within a week and keeps this transaction instead of adding another.
 */
export async function recordBillPayment(
  bill: Pick<HomeBill, 'scheduleId' | 'cardAccountId'>,
  payment: BillPayment,
  payees: readonly Pick<PayeeEntity, 'id' | 'transfer_acct'>[],
) {
  if (bill.scheduleId) {
    await send('schedule/post-transaction', {
      id: bill.scheduleId,
      amount: -payment.amount,
      date: payment.date,
      account: payment.accountId,
    });
    return;
  }

  const transferPayee = payees.find(
    payee => bill.cardAccountId && payee.transfer_acct === bill.cardAccountId,
  );
  if (!transferPayee) {
    throw new Error('No transfer payee for this card');
  }
  await send('transactions-batch-update', {
    added: [
      {
        id: uuidv4(),
        account: payment.accountId,
        payee: transferPayee.id,
        amount: -payment.amount,
        date: payment.date,
        cleared: false,
      },
    ],
  });
}
