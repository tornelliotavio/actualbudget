import { addDays, addMonths, getDay, getMonthEnd } from '#shared/months';

import { nextBusinessDay } from './calendar';
import type {
  BillDateOverride,
  BillPeriod,
  CardSchedule,
  DateString,
  MonthString,
} from './types';

export type BillCalendar = {
  period(referenceMonth: MonthString): BillPeriod;
  monthForDate(date: DateString): MonthString;
};

function assertDay(day: number, name: string) {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`${name} must be an integer from 1 to 31`);
  }
}

export function assertSchedule(schedule: CardSchedule) {
  assertDay(schedule.dueDay, 'due day');
  if (schedule.closing.kind === 'fixed_day') {
    assertDay(schedule.closing.day, 'closing day');
  } else if (
    !Number.isInteger(schedule.closing.days) ||
    schedule.closing.days < 1 ||
    schedule.closing.days > 28
  ) {
    throw new Error('days before due must be an integer from 1 to 28');
  }
}

/** `day` in `month`, or the month's last day when it has fewer days. */
export function clampDay(month: MonthString, day: number): DateString {
  const last = getDay(getMonthEnd(`${month}-01`));
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function monthsBetween(from: MonthString, to: MonthString): number {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

function nominalDueDate(schedule: CardSchedule, month: MonthString) {
  return clampDay(month, schedule.dueDay);
}

function computedClosingDate(
  schedule: CardSchedule,
  month: MonthString,
): DateString {
  const { closing, dueDay } = schedule;
  if (closing.kind === 'days_before_due') {
    return addDays(nominalDueDate(schedule, month), -closing.days);
  }
  const closingMonth = dueDay > closing.day ? month : addMonths(month, -1);
  return clampDay(closingMonth, closing.day);
}

/**
 * Bills of one card, identified by the month of their nominal due date.
 * Dates the bank or the user stated replace the computed ones for that bill;
 * a bill starts where the previous one closed, so an override also moves the
 * start of the following bill.
 */
export function createBillCalendar(
  schedule: CardSchedule,
  overrides: BillDateOverride[] = [],
): BillCalendar {
  assertSchedule(schedule);
  const overrideByMonth = new Map(
    overrides.map(override => [override.referenceMonth, override]),
  );
  const cache = new Map<MonthString, BillPeriod>();

  function closingDate(month: MonthString): DateString {
    return (
      overrideByMonth.get(month)?.closingDate ??
      computedClosingDate(schedule, month)
    );
  }

  function period(month: MonthString): BillPeriod {
    const cached = cache.get(month);
    if (cached) {
      return cached;
    }
    const override = overrideByMonth.get(month);
    const closing = closingDate(month);
    const previousClosing = closingDate(addMonths(month, -1));
    const dueDate = override?.dueDate ?? nominalDueDate(schedule, month);
    const result: BillPeriod = {
      referenceMonth: month,
      startDate: schedule.closingDayInNextBill
        ? previousClosing
        : addDays(previousClosing, 1),
      endDate: schedule.closingDayInNextBill ? addDays(closing, -1) : closing,
      closingDate: closing,
      dueDate,
      effectiveDueDate: nextBusinessDay(dueDate),
      budgetDate: nominalDueDate(schedule, month),
      datesSource:
        override && (override.closingDate || override.dueDate)
          ? override.source
          : 'computed',
    };
    cache.set(month, result);
    return result;
  }

  function monthForDate(date: DateString): MonthString {
    // The bill closing in the date's month is the earliest candidate whose
    // period can contain it; overrides shift periods by days, not months.
    let month = addMonths(date.slice(0, 7), -2);
    for (let step = 0; step < 6; step++) {
      if (date <= period(month).endDate) {
        return month;
      }
      month = addMonths(month, 1);
    }
    return month;
  }

  return { period, monthForDate };
}
