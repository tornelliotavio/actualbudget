import { classifyEntry } from './classify';
import { cardEntry } from './test-fixtures';

describe('classifyEntry', () => {
  it('recognizes bill payments from each bank', () => {
    const mercadoPago = cardEntry({
      id: 'a',
      date: '2026-10-13',
      amount: 140753,
      description: 'Pagamento recebido',
      provider: { operationType: 'PAGAMENTO_FATURA' },
    });
    const interOnline = cardEntry({
      id: 'b',
      date: '2026-09-10',
      amount: 90824,
      description: 'PAGAMENTO ON LINE',
      provider: { operationType: 'PAGAMENTO' },
    });
    const interAutomatic = cardEntry({
      id: 'c',
      date: '2026-08-10',
      amount: 55774,
      description: 'PAGTO DEBITO AUTOMATICO',
      provider: { operationType: 'PAGAMENTO' },
    });
    expect(classifyEntry(mercadoPago)).toBe('payment');
    expect(classifyEntry(interOnline)).toBe('payment');
    expect(classifyEntry(interAutomatic)).toBe('payment');
  });

  it('treats transfers in as payments', () => {
    const transfer = cardEntry({
      id: 'a',
      date: '2026-10-13',
      amount: 5000,
      description: 'anything',
      isTransfer: true,
    });
    expect(classifyEntry(transfer)).toBe('payment');
  });

  it('treats other credits as refunds', () => {
    const refund = cardEntry({
      id: 'a',
      date: '2026-09-16',
      amount: 2303,
      description: 'APPLE.COM/BILL         SAO PAULO     BRA',
      provider: { operationType: 'PAGAMENTO' },
    });
    expect(classifyEntry(refund)).toBe('credit');
  });

  it('uses user payment descriptions and provider payment lists', () => {
    const credit = cardEntry({
      id: 'a',
      date: '2026-09-16',
      amount: 1000,
      description: 'Credito Banco X',
    });
    expect(classifyEntry(credit, { paymentStems: ['CREDITO BANCO X'] })).toBe(
      'payment',
    );
    expect(classifyEntry(credit, { isProviderPayment: () => true })).toBe(
      'payment',
    );
  });

  it('separates installments, fees and purchases', () => {
    expect(
      classifyEntry(
        cardEntry({
          id: 'a',
          date: '2026-08-11',
          amount: -19500,
          description: 'PNEUCENTERCENTRO       BARRETOS      BRA',
          provider: { installment: { number: 2, count: 6 } },
        }),
      ),
    ).toBe('installment');
    expect(
      classifyEntry(
        cardEntry({
          id: 'b',
          date: '2026-08-02',
          amount: -471,
          description: 'IOF INTERNACIONAL',
          provider: { operationType: 'TARIFA', feeType: 'OTHER' },
        }),
      ),
    ).toBe('fee');
    expect(
      classifyEntry(
        cardEntry({
          id: 'c',
          date: '2026-09-01',
          amount: -32404,
          description: 'CURSOR, AI POWERED IDE',
          provider: { feeType: 'OTHER', otherCreditsType: 'OTHER' },
        }),
      ),
    ).toBe('purchase');
  });
});
