import { getHomeSummary } from './homeSummary';

const input = {
  income: 700000,
  spent: 250000,
  toPay: 160000,
  incomePending: 0,
  cashTotal: 410000,
  isCurrentMonth: true,
};

describe('getHomeSummary', () => {
  it('keeps the cash left after the bills still to pay this month', () => {
    expect(getHomeSummary(input)).toEqual({
      income: 700000,
      spent: 250000,
      toPay: 160000,
      left: 250000,
      leftWithIncome: null,
    });
  });

  it('adds the income still expected separately', () => {
    expect(
      getHomeSummary({ ...input, incomePending: 100000 }).leftWithIncome,
    ).toBe(350000);
  });

  it('nets income and spending for another month', () => {
    expect(getHomeSummary({ ...input, isCurrentMonth: false }).left).toBe(
      450000,
    );
  });
});
