import {
  descriptionStem,
  installmentFrom,
  parseInstallmentLabel,
  splitInstallments,
} from './installments';

describe('installments', () => {
  it('reads installment markers from descriptions', () => {
    expect(parseInstallmentLabel('LOJA X PARC 02/06')).toEqual({
      number: 2,
      count: 6,
    });
    expect(parseInstallmentLabel('Parcela 3 de 10 - Loja')).toEqual({
      number: 3,
      count: 10,
    });
    expect(parseInstallmentLabel('MAGALU 1/12')).toEqual({
      number: 1,
      count: 12,
    });
  });

  it('ignores dates and impossible markers', () => {
    expect(parseInstallmentLabel('COMPRA 10/10/2026')).toBeNull();
    expect(parseInstallmentLabel('LOJA 7/6')).toBeNull();
    expect(parseInstallmentLabel('LOJA 1/1')).toBeNull();
    expect(parseInstallmentLabel('APPLE.COM/BILL')).toBeNull();
  });

  it('builds installment info from bank metadata', () => {
    expect(installmentFrom(2, 6)).toEqual({ number: 2, count: 6 });
    expect(installmentFrom(null, 6)).toBeNull();
    expect(installmentFrom(1, 1)).toBeNull();
  });

  it('reduces descriptions to a stable stem', () => {
    expect(descriptionStem('PNEUCENTERCENTRO       BARRETOS      BRA')).toBe(
      'PNEUCENTERCENTRO BARRETOS BRA',
    );
    expect(descriptionStem('Loja Ação PARC 02/06')).toBe('LOJA ACAO');
    expect(descriptionStem('Loja Ação 03/06')).toBe('LOJA ACAO');
    expect(descriptionStem('DECOLAR*696898348')).toBe('DECOLAR*696898348');
  });

  it('splits totals without losing cents', () => {
    expect(splitInstallments(-100000, 6)).toEqual([
      -16667, -16667, -16667, -16667, -16666, -16666,
    ]);
    expect(splitInstallments(60000, 6)).toEqual(Array(6).fill(10000));
    expect(
      splitInstallments(-100001, 3).reduce((sum, part) => sum + part, 0),
    ).toBe(-100001);
  });
});
