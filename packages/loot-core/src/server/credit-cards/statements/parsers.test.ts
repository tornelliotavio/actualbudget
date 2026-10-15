import { postingDate, toStatementRows } from './rows';
import { line, rennerStatement, riachueloStatement } from './test-fixtures';
import type { StatementText } from './types';

import { findStatementParser } from './index';

function parse(text: StatementText) {
  const parser = findStatementParser(text);
  if (!parser) {
    throw new Error('No parser recognized the statement');
  }
  return parser.parse(text);
}

const rennerEntries = [
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
  line([17, '16/09/2026'], [314, 'RAILWAY'], [536, '7,37']),
  line([64, 'IOF Transacoes Exterior USD 39.04 = USD 39.04 Cotação']),
  line([64, 'dolar R$ 5.3927']),
  line([18, '13/09/2026'], [64, 'Pagamento Fatura Pix'], [526, '-955,62']),
  line([17, '28/09/2026'], [64, 'ANUIDADE Int - Parc.9/12'], [532, '23,90']),
];

const riachueloEntries = [
  line(
    [43, '14/10/26 001'],
    [90, 'Seguro Perda e Roubo - RCHLO'],
    [535, '+ 2,61'],
  ),
  line([90, 'MARIA D SILVA'], [222, '9876']),
  line(
    [43, '18/10/25 065'],
    [90, 'MERCADO*IMPRESSORAS'],
    [427, '5.259,00'],
    [472, '12/12'],
    [528, '+ 438,25'],
  ),
  line([90, 'SUBTOTAL'], [526, '440,86']),
  line([43, '14/09/26 001'], [90, 'PAGAMENTO'], [525, '- 1.320,64']),
  line(
    [43, '13/10/26 001'],
    [90, 'ANUIDADE RIACHUELO - TITULAR'],
    [472, '04/12'],
    [531, '+ 15,99'],
  ),
];

describe('Renner statements', () => {
  const statement = parse(rennerStatement({ entries: rennerEntries }));

  it('reads the bill', () => {
    expect(statement).toMatchObject({
      issuer: 'renner',
      cardLast4: '1234',
      closingDate: '2026-09-28',
      dueDate: '2026-10-13',
      total: 191225,
      minimumPayment: 156719,
      creditLimit: 1000000,
      availableLimit: 728775,
    });
  });

  it('reads charges, payments and installments', () => {
    expect(statement.entries).toEqual([
      {
        date: '2026-01-30',
        description: 'Parcela de compra lojista MasterCard - Parc.8/10',
        merchant: 'LOJA X',
        amount: -40000,
        installment: { number: 8, count: 10 },
        purchaseTotal: null,
        isPayment: false,
      },
      expect.objectContaining({ merchant: 'IFD IFOOD CLUB', amount: -595 }),
      expect.objectContaining({
        description:
          'IOF Transacoes Exterior USD 39.04 = USD 39.04 Cotação dolar R$ 5.3927',
        merchant: 'RAILWAY',
        amount: -737,
      }),
      expect.objectContaining({ amount: 95562, isPayment: true }),
      expect.objectContaining({
        amount: -2390,
        installment: { number: 9, count: 12 },
      }),
    ]);
  });

  it('leaves out the installments of later bills', () => {
    expect(
      statement.entries.filter(entry => entry.description.includes('9/10')),
    ).toEqual([]);
  });

  it("charges an older purchase's installment within the cycle", () => {
    expect(postingDate(statement.entries[0], statement)).toBe('2026-08-30');
    expect(postingDate(statement.entries[4], statement)).toBe('2026-09-28');
  });
});

describe('Riachuelo statements', () => {
  const statement = parse(riachueloStatement({ entries: riachueloEntries }));

  it('reads the bill', () => {
    expect(statement).toMatchObject({
      issuer: 'riachuelo',
      cardLast4: '9876',
      closingDate: '2026-10-06',
      dueDate: '2026-10-13',
      total: 132064,
      minimumPayment: null,
      creditLimit: 1342000,
      availableLimit: 866280,
    });
  });

  it('reads entries, skipping cardholder names and subtotals', () => {
    expect(statement.entries).toEqual([
      expect.objectContaining({
        date: '2026-10-14',
        description: 'Seguro Perda e Roubo - RCHLO',
        amount: -261,
        installment: null,
      }),
      {
        date: '2025-10-18',
        description: 'MERCADO*IMPRESSORAS',
        merchant: null,
        amount: -43825,
        installment: { number: 12, count: 12 },
        purchaseTotal: -525900,
        isPayment: false,
      },
      expect.objectContaining({ amount: 132064, isPayment: true }),
      expect.objectContaining({
        amount: -1599,
        installment: { number: 4, count: 12 },
      }),
    ]);
  });
});

describe('statement rows', () => {
  it('carry what the card rules read from bank sync', () => {
    const statement = parse(riachueloStatement({ entries: riachueloEntries }));
    const [, printer, payment] = toStatementRows(statement);
    expect(printer).toMatchObject({
      transactionId: 'statement:riachuelo:2026-10-13:2026-09-18:-43825:1',
      date: '2026-09-18',
      amount: -438.25,
      payeeName: 'MERCADO*IMPRESSORAS',
      'creditCardMetadata.billId': 'statement:riachuelo:2026-10-13',
      'creditCardMetadata.purchaseDate': '2025-10-18',
      'creditCardMetadata.installmentNumber': 12,
      'creditCardMetadata.totalInstallments': 12,
      'creditCardMetadata.totalAmount': 5259,
      'creditCardMetadata.cardNumber': '9876',
    });
    expect(payment).toMatchObject({
      operationType: 'PAGAMENTO_FATURA',
      'creditCardMetadata.billId': null,
    });
  });

  it('tell identical lines apart', () => {
    const statement = parse(
      rennerStatement({
        entries: [
          line([17, '12/09/2026'], [314, 'CAFE'], [536, '5,00']),
          line([17, '12/09/2026'], [314, 'CAFE'], [536, '5,00']),
        ],
      }),
    );
    expect(toStatementRows(statement).map(row => row.transactionId)).toEqual([
      'statement:renner:2026-10-13:2026-09-12:-500:1',
      'statement:renner:2026-10-13:2026-09-12:-500:2',
    ]);
  });

  it('are not read from an unknown issuer', () => {
    expect(
      findStatementParser({ pages: [[line([10, 'Some other bank'])]] }),
    ).toBeNull();
  });
});
