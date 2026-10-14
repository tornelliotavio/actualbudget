import { planBillAdjustments } from './adjustments';
import { createBillCalendar } from './bill-calendar';
import { billAdjustmentId } from './ids';
import { summarizeBills } from './summary';

const calendar = createBillCalendar({
  closing: { kind: 'fixed_day', day: 5 },
  dueDay: 12,
  closingDayInNextBill: true,
});

function bills(providerTotal: number | null) {
  return summarizeBills(
    calendar,
    [
      {
        date: '2026-10-20',
        amount: -100000,
        kind: 'purchase',
        bill: '2026-11',
        projected: false,
      },
    ],
    [
      {
        referenceMonth: '2026-11',
        providerTotal,
        userTotal: null,
        minimumPayment: null,
      },
    ],
    ['2026-11'],
    '2026-11-06',
  );
}

function plan(
  providerTotal: number | null,
  financeCharges: number,
  existing: Array<{ id: string; bill: string; amount: number }> = [],
  deletedIds = new Set<string>(),
  from: string | null = '2026-10-14',
) {
  return planBillAdjustments({
    accountId: 'card',
    calendar,
    bills: bills(providerTotal),
    financeChargesByMonth: new Map([['2026-11', financeCharges]]),
    existing,
    deletedIds,
    from,
  });
}

const id = billAdjustmentId('card', '2026-11');

describe('planBillAdjustments', () => {
  it('charges the finance charges the bank only listed on the bill', () => {
    expect(plan(102350, 2350)).toEqual({
      upsert: [
        {
          id,
          bill: '2026-11',
          amount: -2350,
          date: '2026-11-05',
          budgetDate: '2026-11-12',
        },
      ],
      remove: [],
    });
  });

  it('leaves a gap the finance charges do not explain', () => {
    expect(plan(105000, 2350).upsert).toEqual([]);
  });

  it('removes the adjustment once the charges arrived as transactions', () => {
    expect(
      plan(100000, 2350, [{ id, bill: '2026-11', amount: -2350 }]),
    ).toEqual({ upsert: [], remove: [id] });
  });

  it('writes nothing when the adjustment is already right', () => {
    expect(
      plan(102350, 2350, [{ id, bill: '2026-11', amount: -2350 }]),
    ).toEqual({ upsert: [], remove: [] });
  });

  it('does not recreate an adjustment the user deleted', () => {
    expect(plan(102350, 2350, [], new Set([id])).upsert).toEqual([]);
  });

  it('leaves bills the starting balance already covers', () => {
    expect(plan(102350, 2350, [], new Set(), '2026-11-06').upsert).toEqual([]);
  });
});
