import { formatMoney } from './format';
import {
  limitReceipts,
  pendingCardBills,
  pendingSchedules,
  receiptLabel,
  sortPendingBills,
  summarizeSpending,
} from './summarize';
import type { ScheduleInput } from './summarize';
import type { Receipt } from './types';

vi.mock('@actual-app/api', () => ({
  utils: {
    integerToAmount: (cents: number) => cents / 100,
    amountToInteger: (amount: number) => Math.round(amount * 100),
  },
}));

const today = '2026-11-02';
const monthEnd = '2026-11-30';

function schedule(overrides: Partial<ScheduleInput>): ScheduleInput {
  return {
    name: 'Aluguel',
    nextDate: '2026-11-10',
    completed: false,
    amount: -140000,
    amountOp: 'is',
    paidDates: [],
    ...overrides,
  };
}

describe('pendingSchedules', () => {
  it('lists a bill due this month', () => {
    expect(pendingSchedules([schedule({})], today, monthEnd)).toEqual([
      {
        name: 'Aluguel',
        dueDate: '2026-11-10',
        amount: 140000,
        kind: 'schedule',
        isEstimate: false,
        status: 'scheduled',
      },
    ]);
  });

  it('keeps a bill missed last month, as overdue', () => {
    const [bill] = pendingSchedules(
      [schedule({ nextDate: '2026-10-17' })],
      today,
      monthEnd,
    );
    expect(bill.status).toBe('overdue');
  });

  it('skips what is paid, completed, income or due after the month', () => {
    expect(
      pendingSchedules(
        [
          schedule({ paidDates: ['2026-11-09'] }),
          schedule({ completed: true }),
          schedule({ amount: 500000 }),
          schedule({ nextDate: '2026-12-10' }),
        ],
        today,
        monthEnd,
      ),
    ).toEqual([]);
  });

  it('marks approximate amounts as estimates and uses the middle of a range', () => {
    const [approx, range] = pendingSchedules(
      [
        schedule({ amount: -20500, amountOp: 'isapprox' }),
        schedule({
          amount: { num1: -1000, num2: -3000 },
          amountOp: 'isbetween',
        }),
      ],
      today,
      monthEnd,
    );
    expect(approx).toMatchObject({ amount: 20500, isEstimate: true });
    expect(range).toMatchObject({ amount: 2000, isEstimate: true });
  });
});

describe('pendingCardBills', () => {
  const bill = {
    card: 'Cartão Renner',
    referenceMonth: '2026-11',
    dueDate: '2026-11-13',
    status: 'closed',
    due: 42390,
  };

  it('names the card and leaves out what is paid or due later', () => {
    const bills = pendingCardBills(
      [
        bill,
        { ...bill, due: 0 },
        { ...bill, referenceMonth: '2026-12', dueDate: '2026-12-14' },
      ],
      today,
      monthEnd,
    );
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      name: 'Fatura Cartão Renner',
      amount: 42390,
      status: 'scheduled',
    });
  });

  it('calls a bill still open open, until its due date passes', () => {
    const [open, late] = pendingCardBills(
      [
        { ...bill, status: 'open' },
        { ...bill, status: 'open', dueDate: '2026-10-13' },
      ],
      today,
      monthEnd,
    );
    expect(open.status).toBe('open');
    expect(late.status).toBe('overdue');
  });
});

describe('sortPendingBills', () => {
  it('orders by due date, then the largest first', () => {
    const base = {
      name: '',
      kind: 'card' as const,
      isEstimate: false,
      status: 'open' as const,
    };
    const sorted = sortPendingBills([
      { ...base, dueDate: '2026-11-13', amount: 100 },
      { ...base, dueDate: '2026-11-13', amount: 900 },
      { ...base, dueDate: '2026-11-10', amount: 50 },
    ]);
    expect(sorted.map(b => b.amount)).toEqual([50, 900, 100]);
  });
});

describe('summarizeSpending', () => {
  const groups = [
    { id: 'home', name: 'Moradia', isIncome: false },
    { id: 'me', name: 'Pessoal', isIncome: false },
    { id: 'in', name: 'Income', isIncome: true },
  ];
  const categories = [
    { id: 'rent', name: 'Aluguel', group: 'home' },
    { id: 'water', name: 'Água', group: 'home' },
    { id: 'moves', name: 'Movimentações internas', group: 'me' },
    { id: 'sales', name: 'Vendas', group: 'in' },
    { id: 'start', name: 'Starting Balances', group: 'in' },
  ];
  const month = '2026-11';
  const previousMonth = '2026-10';
  const summarize = (rows: Parameters<typeof summarizeSpending>[0]['rows']) =>
    summarizeSpending({
      rows,
      categories,
      groups,
      ignored: ['movimentações INTERNAS', 'Starting Balances'],
      month,
      previousMonth,
    });

  it('groups spending as positive amounts, largest first', () => {
    const { spending, totals } = summarize([
      { month, category: 'water', amount: -4000 },
      { month, category: 'rent', amount: -140000 },
      { month: previousMonth, category: 'rent', amount: -130000 },
    ]);
    expect(spending).toEqual([
      {
        name: 'Moradia',
        total: 144000,
        previous: 130000,
        categories: [
          { name: 'Aluguel', total: 140000, previous: 130000 },
          { name: 'Água', total: 4000, previous: 0 },
        ],
      },
    ]);
    expect(totals.spent).toBe(144000);
  });

  it('keeps last month in the totals when this month has no such spending', () => {
    const { spending, totals } = summarize([
      { month: previousMonth, category: 'rent', amount: -130000 },
      { month: previousMonth, category: 'sales', amount: 9000 },
    ]);
    expect(spending).toEqual([]);
    expect(totals.previousSpent).toBe(130000);
    expect(totals.previousReceived).toBe(9000);
  });

  it('leaves ignored categories out of the lines and the totals', () => {
    const { spending, income, totals } = summarize([
      { month, category: 'moves', amount: 109005 },
      { month, category: 'start', amount: 500000 },
    ]);
    expect(spending).toEqual([]);
    expect(income).toEqual([]);
    expect(totals.spent).toBe(0);
    expect(totals.received).toBe(0);
  });

  it('counts money out with no category, but not money in', () => {
    const out = summarize([{ month, category: null, amount: -7500 }]);
    expect(out.spending[0]).toMatchObject({
      name: 'Sem categoria',
      total: 7500,
    });
    expect(out.totals.spent).toBe(7500);

    const incoming = summarize([{ month, category: null, amount: 4500 }]);
    expect(incoming.spending).toEqual([]);
    expect(incoming.totals.spent).toBe(0);
  });

  it('reports income apart from spending', () => {
    const { income, totals } = summarize([
      { month, category: 'sales', amount: 11980 },
    ]);
    expect(income).toEqual([{ name: 'Vendas', total: 11980, previous: 0 }]);
    expect(totals.received).toBe(11980);
    expect(totals.spent).toBe(0);
  });
});

describe('receiptLabel', () => {
  it('prefers the payee', () => {
    expect(receiptLabel('Maria', 'Pix recebido - Outra')).toBe('Maria');
  });

  it('falls back to the bank description for tax ids and missing payees', () => {
    expect(receiptLabel('525.938.178-52', 'Pix recebido - Lucas Andrade')).toBe(
      'Lucas Andrade',
    );
    expect(receiptLabel(null, 'Dinheiro retirado')).toBe('Dinheiro retirado');
    expect(receiptLabel(null, null)).toBe('Sem descrição');
  });
});

describe('limitReceipts', () => {
  it('keeps the largest and adds up the rest', () => {
    const receipt = (amount: number): Receipt => ({
      date: '2026-11-01',
      label: '',
      account: '',
      category: null,
      kind: 'uncategorized',
      amount,
    });
    const { receipts, otherReceipts } = limitReceipts(
      [receipt(10), receipt(30), receipt(20), receipt(5)],
      2,
    );
    expect(receipts.map(r => r.amount)).toEqual([30, 20]);
    expect(otherReceipts).toEqual({ count: 2, amount: 15 });
  });
});

describe('formatMoney', () => {
  it('writes reais the Brazilian way', () => {
    expect(formatMoney(123456)).toBe('R$ 1.234,56');
    expect(formatMoney(-5)).toBe('-R$ 0,05');
  });
});
