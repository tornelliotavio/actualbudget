import { describe, expect, it } from 'vitest';

import { planInstallments, unpostedInstallments } from './installment-plans';
import type { InstallmentTransaction } from './installment-plans';

function charge(
  id: string,
  date: string,
  amount: number,
  number: number,
  total: number,
  notes = 'PNEUCENTERCENTRO',
): InstallmentTransaction {
  return {
    id,
    date,
    amount,
    notes,
    payeeName: null,
    transferId: null,
    rawSyncedData: JSON.stringify({
      'creditCardMetadata.installmentNumber': number,
      'creditCardMetadata.totalInstallments': total,
    }),
  };
}

describe('installment plans', () => {
  it('projects the remaining installments from the posted parts', () => {
    const { plans, conflicts } = planInstallments('card', [
      charge('second', '2026-08-11', -19500, 2, 6),
      charge('third', '2026-09-11', -19500, 3, 6),
    ]);

    expect(conflicts).toEqual([]);
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan?.purchaseDate).toBe('2026-07-11');
    expect(plan?.totalAmount).toBe(117000);
    expect(plan?.installmentCount).toBe(6);
    expect(plan ? unpostedInstallments(plan) : []).toEqual([
      {
        number: 4,
        amount: 19500,
        date: '2026-10-11',
        transactionId: null,
      },
      {
        number: 5,
        amount: 19500,
        date: '2026-11-11',
        transactionId: null,
      },
      {
        number: 6,
        amount: 19500,
        date: '2026-12-11',
        transactionId: null,
      },
    ]);
  });

  it('treats a one-day posting drift as the same purchase', () => {
    const { plans } = planInstallments('card', [
      charge('second', '2026-08-12', -19500, 2, 6),
      charge('third', '2026-09-13', -19500, 3, 6),
    ]);

    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan?.purchaseDate).toBe('2026-07-12');
    expect(
      plan ? unpostedInstallments(plan).map(part => part.date) : [],
    ).toEqual(['2026-10-12', '2026-11-12', '2026-12-12']);
  });

  it('does not invent installments after the last one has posted', () => {
    const { plans } = planInstallments('card', [
      charge('first', '2026-08-18', -19000, 1, 2, 'ESPECIALISTA MOTOS'),
      charge('second', '2026-09-18', -19000, 2, 2, 'ESPECIALISTA MOTOS'),
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0] ? unpostedInstallments(plans[0]) : []).toEqual([]);
  });
});
