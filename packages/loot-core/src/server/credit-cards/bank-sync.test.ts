// @ts-strict-ignore
import * as asyncStorage from '#platform/server/asyncStorage';
import { syncAccount } from '#server/accounts/sync';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { handlers } from '#server/tests/mockSyncServer';
import { loadRules } from '#server/transactions/transaction-rules';
import * as monthUtils from '#shared/months';

vi.mock('#shared/months', async () => ({
  ...(await vi.importActual('#shared/months')),
  currentDay: vi.fn(),
  currentMonth: vi.fn(),
}));

const CARD = 'card-account';
const CHECKING = 'checking-account';

function setToday(day: string) {
  vi.mocked(monthUtils.currentDay).mockReturnValue(day);
  vi.mocked(monthUtils.currentMonth).mockReturnValue(day.slice(0, 7));
}

beforeEach(async () => {
  vi.resetAllMocks();
  setToday('2026-10-14');
  vi.mocked(asyncStorage.getItem).mockResolvedValue('test-token');
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();

  await db.insertAccount({
    id: CARD,
    name: 'Cartão Inter',
    account_id: 'pluggy-card',
    account_sync_source: 'pluggyai',
  });
  await db.insertPayee({ name: '', transfer_acct: CARD });
  await db.insertAccount({
    id: CHECKING,
    name: 'Inter PF',
    account_id: 'pluggy-checking',
    account_sync_source: 'pluggyai',
  });
  await db.insertPayee({ name: '', transfer_acct: CHECKING });
  // An older transaction makes each sync a regular one, not a first link.
  for (const account of [CARD, CHECKING]) {
    await db.insertTransaction({
      account,
      amount: 0,
      date: '2026-07-01',
      starting_balance_flag: true,
    });
  }
});

afterEach(() => {
  delete handlers['/pluggyai/transactions'];
});

/** A transaction as the sync server returns it after its own mapping. */
function pluggyTransaction(fields: Record<string, unknown>) {
  const date = fields.date as string;
  const amount = fields.amount as number;
  return {
    id: fields.id,
    accountId: 'pluggy-card',
    type: amount < 0 ? 'DEBIT' : 'CREDIT',
    status: 'POSTED',
    operationType: 'PAGAMENTO',
    currencyCode: 'BRL',
    description: fields.description,
    descriptionRaw: null,
    booked: fields.status !== 'PENDING',
    originalDate: date,
    payeeName: '',
    notes: fields.description,
    transactionAmount: { amount, currency: 'BRL' },
    transactionId: fields.id,
    sortOrder: Date.parse(date),
    ...fields,
  };
}

const cardSnapshot = {
  connector: 'open_finance',
  creditLimit: 2240,
  availableCreditLimit: 625.85,
  balanceCloseDate: '2026-11-04',
  balanceDueDate: '2026-11-10',
  minimumPayment: null,
  brand: 'MASTERCARD',
  status: 'ACTIVE',
  holderType: 'MAIN',
  bills: [
    {
      id: 'bill-oct',
      dueDate: '2026-10-10',
      closingDate: null,
      totalAmount: 1590,
      minimumPaymentAmount: 238.5,
      financeCharges: [],
      payments: [],
    },
  ],
};

function respond(
  accountId: string,
  transactions: Array<Record<string, unknown>>,
  creditCard: unknown = cardSnapshot,
) {
  const pluggyId = accountId === CARD ? 'pluggy-card' : 'pluggy-checking';
  handlers['/pluggyai/transactions'] = (body: { accountId: string }) => {
    if (body.accountId !== pluggyId) {
      throw new Error('unexpected account ' + body.accountId);
    }
    return {
      balances: [],
      startingBalance: 0,
      transactions: {
        all: transactions,
        booked: transactions.filter(t => t.booked),
        pending: transactions.filter(t => !t.booked),
      },
      creditCard,
    };
  };
}

async function syncCard() {
  return syncAccount(undefined, undefined, CARD, 'pluggy-card', 'bank');
}

async function syncChecking() {
  return syncAccount(undefined, undefined, CHECKING, 'pluggy-checking', 'bank');
}

function cardRows() {
  return db.all<{
    id: string;
    date: number;
    amount: number;
    financial_id: string | null;
    card_bill: string | null;
    card_kind: string | null;
    installment_number: number | null;
    projected: number;
    budget_date: number | null;
    category: string | null;
    transferred_id: string | null;
    bank_sync_missing_since: number | null;
  }>(
    `SELECT id, date, amount, financial_id, card_bill, card_kind,
            installment_number, projected, budget_date, category,
            transferred_id, bank_sync_missing_since
     FROM transactions
     WHERE acct = ? AND tombstone = 0 AND starting_balance_flag = 0
     ORDER BY date, financial_id`,
    [CARD],
  );
}

// PNEUCENTERCENTRO in the 2026-10-14 export: bought 2026-07-11 in 6x, sent
// month by month, each dated on the day it posted to the bill.
const tyres = (number: number, date: string, extra = {}) =>
  pluggyTransaction({
    id: `tyres-${number}`,
    date,
    amount: -195,
    description: 'PNEUCENTERCENTRO       BARRETOS      BRA',
    'creditCardMetadata.installmentNumber': number,
    'creditCardMetadata.totalInstallments': 6,
    'creditCardMetadata.purchaseDate': '2026-07-11T03:00:00.000Z',
    'creditCardMetadata.cardNumber': '2071',
    ...extra,
  });

describe('credit card bank sync', () => {
  it('turns a Pluggy credit account into a card and reads its bank data', async () => {
    respond(CARD, [
      tyres(3, '2026-09-13', { 'creditCardMetadata.billId': 'bill-oct' }),
    ]);
    await syncCard();

    const account = await db.first<{
      kind: string;
      balance_limit: number;
      balance_available: number;
    }>(
      'SELECT kind, balance_limit, balance_available FROM accounts WHERE id = ?',
      [CARD],
    );
    expect(account).toEqual({
      kind: 'credit_card',
      balance_limit: 224000,
      balance_available: 62585,
    });
    const profile = await db.first(
      'SELECT closing_day_provider, due_day_provider, connector FROM card_profiles WHERE id = ?',
      [CARD],
    );
    expect(profile).toEqual({
      closing_day_provider: 4,
      due_day_provider: 10,
      connector: 'open_finance',
    });
    const bill = await db.first(
      'SELECT reference_month, provider_bill_id, provider_total, provider_minimum FROM card_bills WHERE account = ?',
      [CARD],
    );
    expect(bill).toEqual({
      reference_month: '2026-10',
      provider_bill_id: 'bill-oct',
      provider_total: 159000,
      provider_minimum: 23850,
    });
  });

  it('dates installments by purchase and projects the rest', async () => {
    respond(CARD, [
      tyres(3, '2026-09-13', { 'creditCardMetadata.billId': 'bill-oct' }),
    ]);
    await syncCard();

    const rows = await cardRows();
    expect(
      rows.map(row => [
        row.date,
        row.card_bill,
        row.installment_number,
        row.projected,
        row.budget_date,
      ]),
    ).toEqual([
      [20260911, `${CARD}:2026-10`, 3, 0, 20261010],
      [20261011, `${CARD}:2026-11`, 4, 1, 20261110],
      [20261111, `${CARD}:2026-12`, 5, 1, 20261210],
      [20261211, `${CARD}:2027-01`, 6, 1, 20270110],
    ]);
  });

  it('changes nothing when the same data syncs again', async () => {
    respond(CARD, [
      tyres(3, '2026-09-13', { 'creditCardMetadata.billId': 'bill-oct' }),
      pluggyTransaction({
        id: 'apple',
        date: '2026-10-04',
        amount: -45.9,
        description: 'APPLE.COM/BILL         SAO PAULO     BRA',
        status: 'PENDING',
      }),
    ]);
    await syncCard();
    const before = await db.all('SELECT * FROM transactions ORDER BY id');
    const billsBefore = await db.all('SELECT * FROM card_bills ORDER BY id');

    await syncCard();

    const after = await db.all('SELECT * FROM transactions ORDER BY id');
    expect(after).toEqual(before);
    expect(await db.all('SELECT * FROM card_bills ORDER BY id')).toEqual(
      billsBefore,
    );
  });

  it('replaces a projected installment when the real one arrives', async () => {
    const category = await db.insertCategory({
      name: 'Carro',
      cat_group: await db.insertCategoryGroup({ name: 'Transporte' }),
    });
    respond(CARD, [
      tyres(3, '2026-09-13', { 'creditCardMetadata.billId': 'bill-oct' }),
    ]);
    await syncCard();
    const projectedFourth = (await cardRows()).find(
      row => row.installment_number === 4,
    )!;
    await db.updateTransaction({ id: projectedFourth.id, category });

    setToday('2026-11-06');
    respond(CARD, [
      tyres(3, '2026-09-13', { 'creditCardMetadata.billId': 'bill-oct' }),
      tyres(4, '2026-10-12'),
    ]);
    await syncCard();

    const rows = await cardRows();
    expect(rows.filter(row => row.installment_number === 4)).toEqual([
      expect.objectContaining({
        financial_id: 'tyres-4',
        projected: 0,
        date: 20261011,
        card_bill: `${CARD}:2026-11`,
        category,
      }),
    ]);
    expect(
      rows.filter(row => row.projected).map(row => row.installment_number),
    ).toEqual([5, 6]);
  });

  it('removes a pending charge the bank stopped reporting', async () => {
    const pending = pluggyTransaction({
      id: 'hold',
      date: '2026-10-10',
      amount: -50,
      description: 'POSTO COPERCANA',
      status: 'PENDING',
    });
    const other = pluggyTransaction({
      id: 'netflix',
      date: '2026-10-12',
      amount: -20.9,
      description: 'NETFLIX.COM',
    });
    respond(CARD, [pending, other]);
    await syncCard();
    expect((await cardRows()).map(row => row.financial_id)).toContain('hold');

    respond(CARD, [other]);
    await syncCard();
    const marked = (await cardRows()).find(row => row.financial_id === 'hold');
    expect(marked?.bank_sync_missing_since).toBe(20261014);

    setToday('2026-10-18');
    await syncCard();
    expect((await cardRows()).map(row => row.financial_id)).not.toContain(
      'hold',
    );
  });

  it('links a bill payment imported on both sides as a transfer', async () => {
    respond(CARD, [
      pluggyTransaction({
        id: 'card-payment',
        date: '2026-10-13',
        amount: 1407.53,
        description: 'Pagamento recebido',
        operationType: 'PAGAMENTO_FATURA',
      }),
    ]);
    await syncCard();

    respond(
      CHECKING,
      [
        pluggyTransaction({
          id: 'pix-out',
          accountId: 'pluggy-checking',
          date: '2026-10-13',
          amount: -1407.53,
          description: 'Pix enviado  - Mercado Pago Instituicao De Pagamento',
          operationType: 'PIX',
        }),
      ],
      null,
    );
    await syncChecking();

    const payment = (await cardRows()).find(
      row => row.financial_id === 'card-payment',
    )!;
    expect(payment.card_kind).toBe('payment');
    const debit = await db.first<{
      id: string;
      transferred_id: string;
      category: string | null;
      description: string;
    }>(
      'SELECT id, transferred_id, category, description FROM transactions WHERE financial_id = ?',
      ['pix-out'],
    );
    expect(debit?.transferred_id).toBe(payment.id);
    expect(payment.transferred_id).toBe(debit?.id);
    expect(debit?.category).toBeNull();
    const payee = await db.first<{ transfer_acct: string }>(
      'SELECT p.transfer_acct FROM payee_mapping pm JOIN payees p ON p.id = pm.targetId WHERE pm.id = ?',
      [debit?.description],
    );
    expect(payee?.transfer_acct).toBe(CARD);
  });

  it('imports one row when two syncs insert the same bank transaction', async () => {
    const apple = pluggyTransaction({
      id: 'same',
      date: '2026-10-12',
      amount: -113.85,
      description: 'ANTHROPIC* CLAUDE SUB',
    });
    respond(CARD, [apple]);
    await Promise.all([syncCard(), syncCard()]);
    const rows = await db.all(
      "SELECT id FROM transactions WHERE financial_id = 'same'",
    );
    expect(rows).toHaveLength(1);
  });
});
