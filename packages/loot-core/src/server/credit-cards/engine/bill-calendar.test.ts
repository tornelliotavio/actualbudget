import { clampDay, createBillCalendar, monthsBetween } from './bill-calendar';
import type { CardSchedule } from './types';

const closesOnFifth: CardSchedule = {
  closing: { kind: 'fixed_day', day: 5 },
  dueDay: 12,
  closingDayInNextBill: true,
};

describe('bill calendar', () => {
  it('clamps days to the end of the month', () => {
    expect(clampDay('2027-02', 31)).toBe('2027-02-28');
    expect(clampDay('2028-02', 30)).toBe('2028-02-29');
    expect(clampDay('2026-11', 12)).toBe('2026-11-12');
  });

  it('counts months between reference months', () => {
    expect(monthsBetween('2026-11', '2027-04')).toBe(5);
    expect(monthsBetween('2027-04', '2026-11')).toBe(-5);
  });

  it('names a bill after the month it is due', () => {
    const calendar = createBillCalendar(closesOnFifth);
    expect(calendar.period('2026-11')).toEqual({
      referenceMonth: '2026-11',
      startDate: '2026-10-05',
      endDate: '2026-11-04',
      closingDate: '2026-11-05',
      dueDate: '2026-11-12',
      effectiveDueDate: '2026-11-12',
      budgetDate: '2026-11-12',
      datesSource: 'computed',
    });
  });

  it('moves the effective due date past weekends', () => {
    const calendar = createBillCalendar(closesOnFifth);
    const december = calendar.period('2026-12');
    expect(december.dueDate).toBe('2026-12-12');
    expect(december.effectiveDueDate).toBe('2026-12-14');
    expect(december.budgetDate).toBe('2026-12-12');
  });

  it('puts a purchase on the closing day on the next bill by default', () => {
    const calendar = createBillCalendar(closesOnFifth);
    expect(calendar.monthForDate('2026-10-10')).toBe('2026-11');
    expect(calendar.monthForDate('2026-11-04')).toBe('2026-11');
    expect(calendar.monthForDate('2026-11-05')).toBe('2026-12');
  });

  it('can keep the closing day on the closing bill', () => {
    const calendar = createBillCalendar({
      ...closesOnFifth,
      closingDayInNextBill: false,
    });
    expect(calendar.monthForDate('2026-11-05')).toBe('2026-11');
    expect(calendar.period('2026-12').startDate).toBe('2026-11-06');
  });

  it('handles a due day before the closing day', () => {
    const calendar = createBillCalendar({
      closing: { kind: 'fixed_day', day: 30 },
      dueDay: 7,
      closingDayInNextBill: true,
    });
    expect(calendar.period('2027-03').closingDate).toBe('2027-02-28');
    expect(calendar.period('2027-03').startDate).toBe('2027-01-30');
    expect(calendar.monthForDate('2027-01-29')).toBe('2027-02');
    expect(calendar.monthForDate('2027-01-30')).toBe('2027-03');
  });

  it('closes a fixed number of days before the due date', () => {
    const calendar = createBillCalendar({
      closing: { kind: 'days_before_due', days: 7 },
      dueDay: 10,
      closingDayInNextBill: true,
    });
    expect(calendar.period('2026-11').closingDate).toBe('2026-11-03');
    expect(calendar.period('2026-11').startDate).toBe('2026-10-03');
  });

  it('uses dates the bank stated and shifts the next bill start', () => {
    const calendar = createBillCalendar(closesOnFifth, [
      {
        referenceMonth: '2026-11',
        closingDate: '2026-11-06',
        dueDate: '2026-11-13',
        source: 'provider',
      },
    ]);
    const november = calendar.period('2026-11');
    expect(november.closingDate).toBe('2026-11-06');
    expect(november.endDate).toBe('2026-11-05');
    expect(november.dueDate).toBe('2026-11-13');
    expect(november.budgetDate).toBe('2026-11-12');
    expect(november.datesSource).toBe('provider');
    expect(calendar.period('2026-12').startDate).toBe('2026-11-06');
    expect(calendar.monthForDate('2026-11-05')).toBe('2026-11');
  });

  it('rejects impossible days', () => {
    expect(() => createBillCalendar({ ...closesOnFifth, dueDay: 0 })).toThrow();
    expect(() =>
      createBillCalendar({
        ...closesOnFifth,
        closing: { kind: 'fixed_day', day: 32 },
      }),
    ).toThrow();
  });
});
