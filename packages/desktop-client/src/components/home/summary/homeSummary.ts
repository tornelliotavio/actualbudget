export type HomeSummaryInput = {
  /** Received in the budget month, cents. */
  income: number;
  /** Spent in the budget month, positive cents. */
  spent: number;
  /** Bills still to pay in the month, positive cents. */
  toPay: number;
  /** Income still expected in the month, positive cents. */
  incomePending: number;
  /** Balance of the cash accounts today. */
  cashTotal: number;
  isCurrentMonth: boolean;
};

export type HomeSummary = {
  income: number;
  spent: number;
  toPay: number;
  /**
   * The current month: what the cash accounts keep after the bills still to
   * pay, which already reflects everything spent so far. Other months: what
   * came in minus what went out.
   */
  left: number;
  /** `left` plus the income still expected, for the current month. */
  leftWithIncome: number | null;
};

export function getHomeSummary(input: HomeSummaryInput): HomeSummary {
  const left = input.isCurrentMonth
    ? input.cashTotal - input.toPay
    : input.income - input.spent;
  return {
    income: input.income,
    spent: input.spent,
    toPay: input.toPay,
    left,
    leftWithIncome:
      input.isCurrentMonth && input.incomePending > 0
        ? left + input.incomePending
        : null,
  };
}
