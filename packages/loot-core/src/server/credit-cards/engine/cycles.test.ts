import { describe, expect, it } from 'vitest';

import {
  addCalendarMonths,
  cycleContaining,
  dateInTimeZone,
  resolveCycle,
  upcomingCycles,
} from './cycles';
import type { CycleConfig } from './types';

const current: CycleConfig = {
  closingDay: 10,
  dueDay: 17,
  closingDayPolicy: 'current',
};
const next: CycleConfig = {
  closingDay: 10,
  dueDay: 17,
  closingDayPolicy: 'next',
};

describe('billing cycles', () => {
  it('puts a purchase on the closing day on this bill or the next one', () => {
    expect(cycleContaining('2026-10-10', current)).toMatchObject({
      cycleStart: '2026-09-11',
      cycleEnd: '2026-10-10',
      closingDate: '2026-10-10',
      dueDate: '2026-10-17',
      referenceMonth: '2026-10',
    });
    expect(cycleContaining('2026-10-10', next)).toMatchObject({
      cycleStart: '2026-10-10',
      cycleEnd: '2026-11-09',
      closingDate: '2026-11-10',
      dueDate: '2026-11-17',
      referenceMonth: '2026-11',
    });
    expect(cycleContaining('2026-10-09', next).referenceMonth).toBe('2026-10');
    expect(cycleContaining('2026-10-11', current).referenceMonth).toBe(
      '2026-11',
    );
  });

  it('moves the due date to the next month when the due day is not after closing', () => {
    const config: CycleConfig = {
      closingDay: 25,
      dueDay: 5,
      closingDayPolicy: 'current',
    };
    expect(cycleContaining('2026-10-20', config)).toMatchObject({
      closingDate: '2026-10-25',
      dueDate: '2026-11-05',
      referenceMonth: '2026-11',
    });
  });

  it.each([28, 29, 30, 31])(
    'clamps closing day %s to the length of the month',
    closingDay => {
      const config: CycleConfig = {
        closingDay,
        dueDay: 10,
        closingDayPolicy: 'current',
      };
      // 2026 is not a leap year. 2024 is.
      expect(cycleContaining('2026-02-10', config).closingDate).toBe(
        closingDay >= 28 ? '2026-02-28' : `2026-02-${closingDay}`,
      );
      expect(cycleContaining('2024-02-10', config).closingDate).toBe(
        closingDay >= 29 ? '2024-02-29' : '2024-02-28',
      );
      expect(cycleContaining('2026-01-20', config).closingDate).toBe(
        `2026-01-${closingDay}`,
      );
      expect(cycleContaining('2026-04-15', config).closingDate).toBe(
        closingDay === 31 ? '2026-04-30' : `2026-04-${closingDay}`,
      );
      // Due day 10 is before every one of these closing days, so it is next month.
      expect(cycleContaining('2026-01-20', config).dueDate).toBe('2026-02-10');
    },
  );

  it('clamps a due day of 31 in February', () => {
    const config: CycleConfig = {
      closingDay: 5,
      dueDay: 31,
      closingDayPolicy: 'current',
    };
    expect(cycleContaining('2026-02-03', config).dueDate).toBe('2026-02-28');
    expect(cycleContaining('2024-02-03', config).dueDate).toBe('2024-02-29');
    expect(cycleContaining('2026-01-03', config).dueDate).toBe('2026-01-31');
  });

  it('keeps a stored bill on its old dates after the closing day changes', () => {
    const moved: CycleConfig = {
      closingDay: 20,
      dueDay: 27,
      closingDayPolicy: 'current',
    };
    const cycle = resolveCycle('2026-10-12', moved, [
      {
        referenceMonth: '2026-10',
        cycleStart: '2026-09-11',
        cycleEnd: '2026-10-10',
        closingDate: '2026-10-10',
        dueDate: '2026-10-17',
      },
    ]);
    expect(cycle).toMatchObject({
      referenceMonth: '2026-10',
      closingDate: '2026-10-10',
      dueDate: '2026-10-17',
    });
    expect(resolveCycle('2026-10-21', moved).closingDate).toBe('2026-11-20');
  });

  it('walks forward one cycle at a time', () => {
    const cycles = upcomingCycles('2026-10-15', 3, current);
    expect(cycles.map(cycle => cycle.referenceMonth)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
  });

  it('clamps a day that does not exist when shifting months', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('resolves the calendar date in the card timezone', () => {
    // 02:30 UTC is still the 10th in São Paulo (UTC-3).
    expect(
      dateInTimeZone(new Date('2026-10-11T02:30:00Z'), 'America/Sao_Paulo'),
    ).toBe('2026-10-10');
    expect(
      dateInTimeZone(new Date('2026-10-11T03:00:00Z'), 'America/Sao_Paulo'),
    ).toBe('2026-10-11');
  });
});
