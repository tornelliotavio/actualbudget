import { describe, expect, it } from 'vitest';

import { assignTransaction, owedFromActual } from './assignment';
import { computeBill } from './bills';
import { allocatePayment, carryoverAmount } from './payments';
import { summarize } from './summary';
import type { BillInput, BillView, CycleConfig } from './types';

const config: CycleConfig = {
  closingDay: 10,
  dueDay: 17,
  closingDayPolicy: 'current',
};

function bill(
  overrides: Partial<BillInput> &
    Pick<BillInput, 'id' | 'referenceMonth' | 'closingDate' | 'dueDate'>,
): BillInput {
  return {
    cycleStart: overrides.cycleStart ?? '2026-09-11',
    cycleEnd: overrides.cycleEnd ?? overrides.closingDate,
    confirmedTotal: overrides.confirmedTotal ?? null,
    minimumPayment: overrides.minimumPayment ?? null,
    cancelled: overrides.cancelled ?? false,
    charges: overrides.charges ?? [],
    payments: overrides.payments ?? [],
    ...overrides,
  };
}

function view(input: BillInput, today: string): BillView {
  return computeBill(input, today);
}

describe('bill assignment', () => {
  const bills = [
    {
      id: 'card:2026-10',
      referenceMonth: '2026-10',
      providerBillId: 'pluggy-oct',
    },
    {
      id: 'card:2026-11',
      referenceMonth: '2026-11',
      providerBillId: 'pluggy-nov',
    },
  ];

  it('prefers a link, then the provider bill, then the original date', () => {
    const purchase = {
      id: 't1',
      date: '2026-12-01',
      originalDate: '2026-10-05',
      amount: -20000,
      isTransfer: false,
      metadata: {
        billId: 'pluggy-nov',
        installmentNumber: 2,
        totalInstallments: 6,
        purchaseDate: '2026-09-05',
        totalAmount: 1200,
        originalDate: '2026-10-05',
      },
    };

    expect(
      assignTransaction(purchase, config, bills, {
        link: { billId: 'card:2026-10', kind: 'installment' },
      }).source,
    ).toBe('link');

    expect(assignTransaction(purchase, config, bills)).toMatchObject({
      source: 'provider',
      billId: 'card:2026-11',
      kind: 'installment',
    });

    expect(
      assignTransaction(
        { ...purchase, metadata: { ...purchase.metadata, billId: null } },
        config,
        bills,
      ),
    ).toMatchObject({ source: 'original-date', referenceMonth: '2026-10' });

    expect(
      assignTransaction(
        {
          ...purchase,
          originalDate: null,
          metadata: null,
          date: '2026-10-05',
        },
        config,
        bills,
      ),
    ).toMatchObject({ source: 'date', referenceMonth: '2026-10' });
  });

  it('does not treat a transfer as a charge', () => {
    expect(
      assignTransaction(
        {
          id: 'pay',
          date: '2026-10-17',
          amount: 94825,
          isTransfer: true,
        },
        config,
        bills,
      ).kind,
    ).toBe('payment');
  });

  it('converts an Actual purchase into owed cents', () => {
    expect(owedFromActual(-94825)).toBe(94825);
    expect(owedFromActual(1500)).toBe(-1500);
  });
});

describe('bill figures', () => {
  const today = '2026-10-15';

  const october = bill({
    id: 'card:2026-10',
    referenceMonth: '2026-10',
    closingDate: '2026-10-10',
    dueDate: '2026-10-17',
    confirmedTotal: 94825,
    charges: [
      { id: 'a', owedAmount: 80000, projected: false, kind: 'purchase' },
      { id: 'b', owedAmount: 14000, projected: false, kind: 'installment' },
      { id: 'fee', owedAmount: 825, projected: false, kind: 'interest' },
    ],
  });

  const november = bill({
    id: 'card:2026-11',
    referenceMonth: '2026-11',
    cycleStart: '2026-10-11',
    closingDate: '2026-11-10',
    dueDate: '2026-11-17',
    charges: [
      { id: 'n', owedAmount: 27590, projected: true, kind: 'installment' },
    ],
  });

  const december = bill({
    id: 'card:2026-12',
    referenceMonth: '2026-12',
    cycleStart: '2026-11-11',
    closingDate: '2026-12-10',
    dueDate: '2026-12-17',
    charges: [
      { id: 'd', owedAmount: 19500, projected: true, kind: 'installment' },
    ],
  });

  const january = bill({
    id: 'card:2027-01',
    referenceMonth: '2027-01',
    cycleStart: '2026-12-11',
    closingDate: '2027-01-10',
    dueDate: '2027-01-17',
    charges: [
      { id: 'j', owedAmount: 19500, projected: true, kind: 'installment' },
    ],
  });

  it('shows the October bill and the total commitment as different numbers', () => {
    const views = [october, november, december, january].map(item =>
      view(item, today),
    );
    const summary = summarize(views, today, {
      accountBalance: -200000,
      creditLimit: 500000,
      availableLimit: 310000,
    });

    expect(summary.currentBillAmount).toBe(94825);
    expect(summary.amountDue).toBe(94825);
    expect(summary.amountPaid).toBe(0);
    expect(summary.futureCommitments).toBe(27590 + 19500 + 19500);
    expect(summary.totalCommitment).toBe(161415);
    expect(summary.accountBalance).toBe(-200000);
    expect(summary.creditLimit).toBe(500000);
    expect(summary.availableLimit).toBe(310000);
    expect(summary.statement?.status).toBe('closed');
    expect(summary.openBill?.referenceMonth).toBe('2026-11');
  });

  it('keeps a projected installment off the computed total', () => {
    const computed = view(november, today);
    expect(computed.computedTotal).toBe(0);
    expect(computed.projectedTotal).toBe(27590);
    expect(computed.amountOwed).toBe(0);
    expect(computed.status).toBe('open');
  });

  it('shows the gap instead of rewriting a confirmed total', () => {
    const mismatched = view(
      bill({
        ...october,
        charges: [
          { id: 'a', owedAmount: 90000, projected: false, kind: 'purchase' },
        ],
      }),
      today,
    );
    expect(mismatched.amountOwed).toBe(94825);
    expect(mismatched.computedTotal).toBe(90000);
    expect(mismatched.divergence).toBe(4825);
  });

  it('keeps a partial payment open and carries the remainder', () => {
    const partial = view(
      bill({
        ...october,
        payments: [{ id: 'p', amount: 40000, date: '2026-10-16' }],
      }),
      today,
    );
    expect(partial.amountPaid).toBe(40000);
    expect(partial.remaining).toBe(54825);
    expect(partial.status).toBe('partially_paid');
    expect(carryoverAmount(partial)).toBe(54825);
  });

  it('marks a fully paid bill paid and an unpaid one overdue after the due date', () => {
    const paid = view(
      bill({
        ...october,
        payments: [{ id: 'p', amount: 94825, date: '2026-10-17' }],
      }),
      '2026-10-17',
    );
    expect(paid.status).toBe('paid');
    expect(carryoverAmount(paid)).toBe(0);

    const late = view(october, '2026-10-20');
    expect(late.status).toBe('overdue');
  });

  it('adds interest to the bill it was linked to and lets a refund reduce it', () => {
    const withInterest = view(october, today);
    expect(withInterest.computedTotal).toBe(94825);

    const refunded = view(
      bill({
        ...october,
        confirmedTotal: null,
        charges: [
          { id: 'a', owedAmount: 20000, projected: false, kind: 'purchase' },
          { id: 'r', owedAmount: -5000, projected: false, kind: 'refund' },
        ],
      }),
      today,
    );
    expect(refunded.computedTotal).toBe(15000);
    expect(refunded.amountOwed).toBe(15000);
  });

  it('allocates a payment to the chosen bill and spills the rest onto the next one', () => {
    const views = [october, november].map(item => view(item, '2026-11-12'));
    // November has no confirmed total, so its remaining is 0. Use a closed
    // confirmed bill for the spill target.
    const nextBill = view(
      bill({
        ...november,
        confirmedTotal: 27590,
        charges: [
          { id: 'n', owedAmount: 27590, projected: false, kind: 'installment' },
        ],
      }),
      '2026-11-12',
    );
    const octoberView = views[0];

    expect(
      allocatePayment(94825, [
        {
          id: octoberView.id,
          dueDate: octoberView.dueDate,
          remaining: octoberView.remaining,
        },
      ]),
    ).toEqual({
      allocations: [{ billId: 'card:2026-10', amount: 94825 }],
      unallocated: 0,
    });

    expect(
      allocatePayment(10000, [
        {
          id: octoberView.id,
          dueDate: octoberView.dueDate,
          remaining: octoberView.remaining,
        },
      ]).allocations,
    ).toEqual([{ billId: 'card:2026-10', amount: 10000 }]);

    const spilled = allocatePayment(
      octoberView.remaining + 1000,
      [
        {
          id: octoberView.id,
          dueDate: octoberView.dueDate,
          remaining: octoberView.remaining,
        },
        {
          id: nextBill.id,
          dueDate: nextBill.dueDate,
          remaining: nextBill.remaining,
        },
      ],
      octoberView.id,
    );
    expect(spilled.allocations).toEqual([
      { billId: 'card:2026-10', amount: 94825 },
      { billId: 'card:2026-11', amount: 1000 },
    ]);
    expect(spilled.unallocated).toBe(0);

    expect(allocatePayment(100, [], 'missing')).toEqual({
      allocations: [],
      unallocated: 100,
    });
  });
});
