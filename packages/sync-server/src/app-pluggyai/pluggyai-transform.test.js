import {
  flattenObject,
  isoDate,
  mergeTransactions,
  toActualBill,
  toActualCreditData,
  toActualTransaction,
} from './pluggyai-transform';

// Shaped like pluggy-sdk output: ISO timestamps already turned into Dates.
function cardInstallment() {
  return {
    id: 'a3',
    accountId: 'acc',
    date: new Date('2026-08-12T03:00:00.000Z'),
    description: 'PNEUCENTERCENTRO       BARRETOS      BRA',
    descriptionRaw: null,
    type: 'DEBIT',
    amount: 195,
    amountInAccountCurrency: null,
    currencyCode: 'BRL',
    status: 'POSTED',
    operationType: 'PAGAMENTO',
    creditCardMetadata: {
      installmentNumber: 2,
      totalInstallments: 6,
      purchaseDate: new Date('2026-07-11T03:00:00.000Z'),
      billId: '0c0d718f',
      billPostDate: '2026-08-12',
      cardNumber: '2071',
    },
  };
}

describe('pluggy transform', () => {
  it('keeps dates when flattening', () => {
    expect(
      flattenObject({
        a: { b: new Date('2026-07-11T03:00:00.000Z'), c: null },
        d: 'x',
      }),
    ).toEqual({ 'a.b': '2026-07-11T03:00:00.000Z', d: 'x' });
  });

  it('keeps the bank date and the installment purchase date', () => {
    const result = toActualTransaction(cardInstallment(), 'CREDIT');
    expect(result.date).toBe('2026-08-12');
    expect(result.originalDate).toBe('2026-08-12');
    expect(result['creditCardMetadata.purchaseDate']).toBe(
      '2026-07-11T03:00:00.000Z',
    );
    expect(result['creditCardMetadata.installmentNumber']).toBe(2);
    expect(result.transactionAmount).toEqual({ amount: -195, currency: 'BRL' });
    expect(result.amount).toBeUndefined();
    expect(result.booked).toBe(true);
    expect(result.notes).toBe('PNEUCENTERCENTRO       BARRETOS      BRA');
  });

  it('flips international card amounts', () => {
    const result = toActualTransaction(
      {
        ...cardInstallment(),
        amount: 25,
        amountInAccountCurrency: 134.43,
        currencyCode: 'USD',
        creditCardMetadata: null,
      },
      'CREDIT',
    );
    expect(result.transactionAmount.amount).toBe(-134.43);
    expect(result.amountInAccountCurrency).toBe(-134.43);
  });

  it('marks pending transactions', () => {
    const result = toActualTransaction(
      { ...cardInstallment(), status: 'PENDING' },
      'CREDIT',
    );
    expect(result.booked).toBe(false);
  });

  it('reads zoneless bill dates as written', () => {
    expect(isoDate('2026-10-10T00:00:00')).toBe('2026-10-10');
    expect(isoDate(new Date('2026-10-10T03:00:00.000Z'))).toBe('2026-10-10');
    expect(isoDate(null)).toBeNull();
  });

  it('maps bills with closing date and payments', () => {
    expect(
      toActualBill({
        id: 'b1',
        dueDate: '2026-10-10T00:00:00',
        billClosingDate: '2026-10-04T00:00:00',
        totalAmount: 948.25,
        totalAmountCurrencyCode: 'BRL',
        minimumPaymentAmount: 142.24,
        financeCharges: [
          { id: 'f', type: 'IOF', amount: 1.2, currencyCode: 'BRL' },
        ],
        payments: [
          {
            id: 'p',
            paymentDate: new Date('2026-10-10T03:00:00.000Z'),
            amount: 948.25,
          },
        ],
      }),
    ).toMatchObject({
      id: 'b1',
      dueDate: '2026-10-10',
      closingDate: '2026-10-04',
      totalAmount: 948.25,
      minimumPaymentAmount: 142.24,
      paidAmount: 948.25,
      payments: [{ id: 'p', date: '2026-10-10', amount: 948.25 }],
    });
  });

  it('reports the connector and credit data', () => {
    expect(
      toActualCreditData(
        {
          creditData: {
            creditLimit: 2240,
            availableCreditLimit: 625.85,
            balanceCloseDate: new Date('2026-11-04T03:00:00.000Z'),
            balanceDueDate: new Date('2026-11-10T03:00:00.000Z'),
            brand: 'MASTERCARD',
            status: 'ACTIVE',
            holderType: 'MAIN',
          },
        },
        { isOpenFinance: true },
      ),
    ).toMatchObject({
      connector: 'open_finance',
      creditLimit: 2240,
      availableCreditLimit: 625.85,
      balanceCloseDate: '2026-11-04',
      balanceDueDate: '2026-11-10',
    });
  });

  it('merges fetches without repeating transactions', () => {
    const a = { id: '1', amount: 1 };
    const b = { id: '2', amount: 2 };
    expect(mergeTransactions([a, b], [{ ...b, amount: 3 }])).toEqual([
      a,
      { id: '2', amount: 3 },
    ]);
  });
});
