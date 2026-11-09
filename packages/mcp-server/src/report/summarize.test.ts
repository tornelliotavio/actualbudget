import { formatMoney } from './format';
import {
  billReminders,
  groupAmounts,
  limitReceipts,
  partOf,
  pendingCardBills,
  pendingSchedules,
  receiptLabel,
  shareOf,
  sortPendingBills,
  splitCash,
  spreadOver,
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
    share: 1,
    category: 'rent',
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
        share: 1,
        category: 'rent',
      },
    ]);
  });

  it("counts only the owner's part of a split bill", () => {
    const [bill] = pendingSchedules(
      [schedule({ amount: -150000, share: 0.5 })],
      today,
      monthEnd,
    );
    expect(bill).toMatchObject({ amount: 75000, share: 0.5 });
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
    share: 1,
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

  it("counts only the owner's part of a shared card", () => {
    const [shared] = pendingCardBills(
      [{ ...bill, due: 87980, share: 0.5 }],
      today,
      monthEnd,
    );
    expect(shared).toMatchObject({ amount: 43990, share: 0.5 });
  });
});

describe('shareOf', () => {
  const shares = [
    { match: 'Aluguel', share: 0.5 },
    { match: 'cartão riachuelo', share: 0.5 },
  ];

  it('finds the part by a piece of the name, ignoring case', () => {
    expect(shareOf('Moradia • Aluguel (Marcelo)', shares)).toBe(0.5);
    expect(shareOf('Cartão Riachuelo', shares)).toBe(0.5);
  });

  it('is all of it when no rule matches', () => {
    expect(shareOf('Financiamento MT-03', shares)).toBe(1);
    expect(shareOf('Aluguel', [])).toBe(1);
  });
});

describe('partOf', () => {
  it('rounds half away from zero on both signs', () => {
    expect(partOf(87981, 0.5)).toBe(43991);
    expect(partOf(-87981, 0.5)).toBe(-43991);
    expect(partOf(-1599, 1)).toBe(-1599);
  });
});

describe('spreadOver', () => {
  it('leaves amounts that already add up alone', () => {
    expect(spreadOver(300, [100, 200])).toEqual([100, 200]);
  });

  it('scales to the total, the rounding on the largest', () => {
    const spread = spreadOver(100, [33, 33, 34]);
    expect(spread.reduce((a, b) => a + b, 0)).toBe(100);
    expect(spreadOver(50, [100, 300])).toEqual([13, 37]);
  });

  it('puts the total on the first when the amounts cancel out', () => {
    expect(spreadOver(500, [100, -100])).toEqual([500, 0]);
    expect(spreadOver(500, [])).toEqual([]);
  });
});

describe('billReminders', () => {
  const bill = {
    name: 'Energia',
    kind: 'schedule' as const,
    isEstimate: false,
    status: 'scheduled' as const,
    amount: 86009,
    share: 1,
    category: null,
  };

  it('splits bills into overdue, due today and due tomorrow', () => {
    const reminders = billReminders(
      [
        { ...bill, dueDate: '2026-11-01' },
        { ...bill, dueDate: '2026-11-02' },
        { ...bill, dueDate: '2026-11-03' },
        { ...bill, dueDate: '2026-11-04' },
      ],
      today,
    );
    expect(reminders.overdue.map(b => b.dueDate)).toEqual(['2026-11-01']);
    expect(reminders.today.map(b => b.dueDate)).toEqual(['2026-11-02']);
    expect(reminders.tomorrow.map(b => b.dueDate)).toEqual(['2026-11-03']);
  });
});

describe('groupAmounts', () => {
  const groups = [
    { id: 'car', name: 'Transporte', isIncome: false },
    { id: 'home', name: 'Moradia', isIncome: false },
  ];
  const categories = [
    { id: 'onix', name: 'Financiamento Onix', group: 'car' },
    { id: 'fuel', name: 'Combustível Onix', group: 'car' },
    { id: 'rent', name: 'Aluguel', group: 'home' },
  ];

  it('groups like the budget, largest first, the unknown apart', () => {
    expect(
      groupAmounts(
        [
          { category: 'rent', amount: 75000 },
          { category: 'onix', amount: 109000 },
          { category: 'fuel', amount: 5000 },
          { category: null, amount: 1810 },
          { category: 'gone', amount: 190 },
        ],
        categories,
        groups,
      ),
    ).toEqual([
      {
        name: 'Transporte',
        total: 114000,
        categories: [
          { name: 'Financiamento Onix', total: 109000 },
          { name: 'Combustível Onix', total: 5000 },
        ],
      },
      {
        name: 'Moradia',
        total: 75000,
        categories: [{ name: 'Aluguel', total: 75000 }],
      },
      { name: 'Sem categoria', total: 2000, categories: [] },
    ]);
  });
});

describe('sortPendingBills', () => {
  it('orders by due date, then the largest first', () => {
    const base = {
      name: '',
      kind: 'card' as const,
      isEstimate: false,
      status: 'open' as const,
      share: 1,
      category: null,
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

describe('splitCash', () => {
  it('counts every account as available except the ones set aside', () => {
    expect(
      splitCash(
        [
          { name: 'Inter MEI', balance: 700000 },
          { name: 'Cofrinho Carro', balance: 100000 },
          { name: 'Cofrinho Casamento', balance: 190905 },
        ],
        ['cofrinho casamento', 'Cofrinho Guardado'],
      ),
    ).toEqual({ cash: 800000, setAside: 190905 });
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
