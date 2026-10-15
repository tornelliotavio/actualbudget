import { getCardBills } from '#server/credit-cards/bills';
import { makeCreditCardAccount } from '#server/credit-cards/profiles';
import { reconcileCardAccount } from '#server/credit-cards/reconcile';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { loadRules } from '#server/transactions/transaction-rules';
import * as monthUtils from '#shared/months';

import { importCardStatement, previewCardStatement } from './import';
import { line, rennerStatement, riachueloStatement } from './test-fixtures';

vi.mock('#shared/months', async () => ({
  ...(await vi.importActual('#shared/months')),
  currentDay: vi.fn(),
  currentMonth: vi.fn(),
}));

const CARD = 'renner-card';
const CHECKING = 'checking-account';

const statement = rennerStatement({
  total: '429,95',
  minimum: 'R$ 64,49',
  entries: [
    line(
      [17, '30/01/2026'],
      [64, 'Parcela de compra lojista MasterCard - Parc.8/10'],
      [314, 'LOJA X'],
      [528, '400,00'],
    ),
    line(
      [17, '12/09/2026'],
      [64, 'Compra a Vista sem Juros MasterCard'],
      [314, 'IFD IFOOD CLUB'],
      [536, '5,95'],
    ),
    line([17, '28/09/2026'], [64, 'ANUIDADE Int - Parc.9/12'], [532, '24,00']),
    line([18, '13/09/2026'], [64, 'Pagamento Fatura Pix'], [526, '-300,00']),
  ],
});

type Row = {
  id: string;
  date: number;
  amount: number;
  category: string | null;
  projected: number | null;
  installment_number: number | null;
};

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(monthUtils.currentDay).mockReturnValue('2026-10-15');
  vi.mocked(monthUtils.currentMonth).mockReturnValue('2026-10');
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();

  await db.insertAccount({ id: CARD, name: 'Cartão Renner' });
  await db.insertPayee({ name: '', transfer_acct: CARD });
  await db.insertAccount({ id: CHECKING, name: 'Inter MEI' });
  await db.insertPayee({ name: '', transfer_acct: CHECKING });
  await makeCreditCardAccount(CARD, { closingDay: 28, dueDay: 13 });
});

async function cardRows() {
  return db.all<Row>(
    `SELECT id, date, amount, category, projected, installment_number
     FROM transactions WHERE acct = ? AND tombstone = 0
     ORDER BY date, amount`,
    [CARD],
  );
}

async function previewStatuses() {
  const result = await previewCardStatement(CARD, statement);
  if (!('preview' in result)) {
    throw new Error(`Preview failed: ${result.error}`);
  }
  return result.preview.entries;
}

async function transferPayeeOf(account: string) {
  const payee = await db.first<{ id: string }>(
    'SELECT id FROM payees WHERE transfer_acct = ?',
    [account],
  );
  if (!payee) {
    throw new Error(`No transfer payee for ${account}`);
  }
  return payee.id;
}

describe('importing a card statement', () => {
  it('imports the bill and its entries the way bank sync would', async () => {
    expect(await importCardStatement(CARD, statement)).toEqual({
      added: 4,
      updated: 0,
      replaced: 0,
    });

    const { bills } = await getCardBills(CARD);
    expect(bills.find(bill => bill.referenceMonth === '2026-10')).toMatchObject(
      {
        closingDate: '2026-09-28',
        providerTotal: 42995,
        minimumPayment: 6449,
      },
    );

    const rows = await cardRows();
    expect(
      rows
        .filter(row => !row.projected)
        .map(row => [db.fromDateRepr(row.date), row.amount]),
    ).toEqual([
      ['2026-08-30', -40000],
      ['2026-09-12', -595],
      ['2026-09-13', 30000],
      // The card's own calendar ends the cycle the day before closing.
      ['2026-09-27', -2400],
    ]);
    // The rest of the purchase is projected on the later bills.
    expect(
      rows
        .filter(row => row.projected && row.amount === -40000)
        .map(row => row.installment_number),
    ).toEqual([9, 10]);
  });

  it('changes nothing when the same statement is imported again', async () => {
    await importCardStatement(CARD, statement);
    const before = await cardRows();

    expect((await previewStatuses()).map(entry => entry.status)).toEqual([
      'imported',
      'imported',
      'imported',
      'imported',
    ]);
    expect(await importCardStatement(CARD, statement)).toEqual({
      added: 0,
      updated: 0,
      replaced: 0,
    });
    expect(await cardRows()).toEqual(before);
  });

  it('replaces entries typed in by hand, keeping their category', async () => {
    const group = await db.insertCategoryGroup({ name: 'Investments' });
    const category = await db.insertCategory({
      name: 'Equipment',
      cat_group: group,
    });
    const manual = await db.insertTransaction({
      account: CARD,
      date: '2026-10-01',
      amount: -40000,
      category,
      notes: 'Installment 8/10, typed in by hand',
    });

    expect((await previewStatuses())[0]).toMatchObject({
      status: 'replaces',
      replaces: { id: manual, date: '2026-10-01' },
    });

    expect(await importCardStatement(CARD, statement)).toMatchObject({
      replaced: 1,
    });
    const rows = await cardRows();
    expect(rows.find(row => row.id === manual)).toBeUndefined();
    expect(
      rows.find(row => !row.projected && row.amount === -40000),
    ).toMatchObject({ category });
  });

  it('matches a payment already on the card as a transfer', async () => {
    const checkingSide = await db.insertTransaction({
      account: CHECKING,
      date: '2026-09-13',
      amount: -30000,
      payee: await transferPayeeOf(CARD),
    });
    const cardSide = await db.insertTransaction({
      account: CARD,
      date: '2026-09-13',
      amount: 30000,
      payee: await transferPayeeOf(CHECKING),
      transfer_id: checkingSide,
    });
    await db.updateTransaction({ id: checkingSide, transfer_id: cardSide });

    expect((await previewStatuses())[3].status).toBe('on-card');

    await importCardStatement(CARD, statement);
    const payments = (await cardRows()).filter(row => row.amount === 30000);
    expect(payments.map(row => row.id)).toEqual([cardSide]);
  });

  it('refuses an account that is not a card', async () => {
    expect(await previewCardStatement(CHECKING, statement)).toEqual({
      error: 'not-a-card',
    });
  });

  it('says when it does not know the issuer', async () => {
    expect(
      await previewCardStatement(CARD, {
        pages: [[line([10, 'Another bank'])]],
      }),
    ).toEqual({ error: 'unknown-issuer', supported: ['Renner', 'Riachuelo'] });
  });
});

describe('importing a statement over entries typed in by hand', () => {
  const RIACHUELO = 'riachuelo-card';

  beforeEach(async () => {
    await db.insertAccount({ id: RIACHUELO, name: 'Cartão Riachuelo' });
    await db.insertPayee({ name: '', transfer_acct: RIACHUELO });
    await makeCreditCardAccount(RIACHUELO, { closingDay: 6, dueDay: 13 });
  });

  it('prefers the entry already on the bill of the statement', async () => {
    // The bank prints this fee after the bill closed.
    const insurance = riachueloStatement({
      entries: [
        line(
          [43, '14/10/26 001'],
          [90, 'Seguro Perda e Roubo - RCHLO'],
          [535, '+ 2,61'],
        ),
      ],
    });
    const onThisBill = await db.insertTransaction({
      account: RIACHUELO,
      date: '2026-09-14',
      amount: -261,
    });
    const onTheNextBill = await db.insertTransaction({
      account: RIACHUELO,
      date: '2026-10-14',
      amount: -261,
    });
    await reconcileCardAccount(RIACHUELO);

    expect(await importCardStatement(RIACHUELO, insurance)).toMatchObject({
      added: 1,
      replaced: 1,
    });
    const ids = (
      await db.all<{ id: string }>(
        'SELECT id FROM transactions WHERE acct = ? AND tombstone = 0',
        [RIACHUELO],
      )
    ).map(row => row.id);
    expect(ids).not.toContain(onThisBill);
    expect(ids).toContain(onTheNextBill);
    expect(ids).toHaveLength(2);
  });
});
