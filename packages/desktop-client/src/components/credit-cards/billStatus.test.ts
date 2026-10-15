import { getDefaultBillMonth } from './billStatus';

const bills = [
  { referenceMonth: '2026-09' },
  { referenceMonth: '2026-10' },
  { referenceMonth: '2026-11' },
];

describe('getDefaultBillMonth', () => {
  it('opens on the bill due this month', () => {
    expect(getDefaultBillMonth(bills, '2026-11', '2026-10')).toBe('2026-10');
  });

  it('falls back when the card has no bill due this month', () => {
    expect(getDefaultBillMonth(bills, '2026-11', '2027-03')).toBe('2026-11');
    expect(getDefaultBillMonth([], null, '2026-10')).toBeNull();
  });
});
