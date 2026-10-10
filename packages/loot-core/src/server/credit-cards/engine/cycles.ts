import { addDays, addMonths, getDay, getMonthEnd } from '#shared/months';

import type { Cycle, CycleConfig, CycleOverride } from './types';

function assertDayOfMonth(day: number, name: string): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`${name} must be an integer from 1 to 31`);
  }
}

export function assertCycleConfig(config: CycleConfig): void {
  assertDayOfMonth(config.closingDay, 'closing day');
  assertDayOfMonth(config.dueDay, 'due day');
  if (
    config.closingDayPolicy !== 'current' &&
    config.closingDayPolicy !== 'next'
  ) {
    throw new Error('closing day policy must be current or next');
  }
}

/** Last valid day when `day` does not exist in `yearMonth` (`YYYY-MM`). */
export function clampDay(yearMonth: string, day: number): string {
  assertDayOfMonth(day, 'day');
  const last = getDay(getMonthEnd(`${yearMonth}-01`));
  const clamped = Math.min(day, last);
  return `${yearMonth}-${String(clamped).padStart(2, '0')}`;
}

export function closingDateForMonth(
  yearMonth: string,
  closingDay: number,
): string {
  return clampDay(yearMonth, closingDay);
}

/**
 * Due date for a closing date. The due day is in the closing month when it
 * falls after the closing day, and in the following month otherwise.
 */
export function dueDateForClosing(
  closingDate: string,
  config: CycleConfig,
): string {
  const closingMonth = closingDate.slice(0, 7);
  const dueMonth =
    config.dueDay <= config.closingDay
      ? addMonths(closingMonth, 1)
      : closingMonth;
  return clampDay(dueMonth, config.dueDay);
}

export function cycleEndingOn(closingDate: string, config: CycleConfig): Cycle {
  assertCycleConfig(config);
  const closingMonth = closingDate.slice(0, 7);
  const previousClosing = closingDateForMonth(
    addMonths(closingMonth, -1),
    config.closingDay,
  );
  // `current` includes the closing day. `next` gives that day to the
  // following cycle, which is what most Brazilian issuers do.
  const cycleStart =
    config.closingDayPolicy === 'next'
      ? previousClosing
      : addDays(previousClosing, 1);
  const cycleEnd =
    config.closingDayPolicy === 'next' ? addDays(closingDate, -1) : closingDate;
  const dueDate = dueDateForClosing(closingDate, config);
  return {
    cycleStart,
    cycleEnd,
    closingDate,
    dueDate,
    referenceMonth: dueDate.slice(0, 7),
  };
}

function cyclesAround(date: string, config: CycleConfig): Cycle[] {
  const month = date.slice(0, 7);
  const cycles: Cycle[] = [];
  for (const offset of [-1, 0, 1, 2]) {
    const closing = closingDateForMonth(
      addMonths(month, offset),
      config.closingDay,
    );
    cycles.push(cycleEndingOn(closing, config));
  }
  return cycles;
}

function containing(
  date: string,
  cycles: Cycle[],
  preferredMonth?: string,
): Cycle | null {
  const matches = cycles.filter(
    cycle => date >= cycle.cycleStart && date <= cycle.cycleEnd,
  );
  if (matches.length === 0) {
    return null;
  }
  if (preferredMonth) {
    const preferred = matches.find(
      cycle => cycle.referenceMonth === preferredMonth,
    );
    if (preferred) {
      return preferred;
    }
  }
  return matches[matches.length - 1];
}

export function cycleContaining(date: string, config: CycleConfig): Cycle {
  assertCycleConfig(config);
  const match = containing(date, cyclesAround(date, config));
  if (!match) {
    throw new Error(`No billing cycle contains ${date}`);
  }
  return match;
}

export function applyOverride(cycle: Cycle, overrides: CycleOverride[]): Cycle {
  const override = overrides.find(
    item => item.referenceMonth === cycle.referenceMonth,
  );
  if (!override) {
    return cycle;
  }
  return {
    referenceMonth: cycle.referenceMonth,
    cycleStart: override.cycleStart || cycle.cycleStart,
    cycleEnd: override.cycleEnd || cycle.cycleEnd,
    closingDate: override.closingDate || cycle.closingDate,
    dueDate: override.dueDate || cycle.dueDate,
  };
}

/**
 * Cycle for a purchase date. Stored dates replace the computed ones, so a
 * later change to the closing day does not move a bill that already has a
 * row.
 */
export function resolveCycle(
  date: string,
  config: CycleConfig,
  overrides: CycleOverride[] = [],
): Cycle {
  assertCycleConfig(config);
  const computed = cyclesAround(date, config);
  const computedMatch = containing(date, computed);
  const resolved = computed.map(cycle => applyOverride(cycle, overrides));
  const match =
    containing(date, resolved, computedMatch?.referenceMonth) ?? computedMatch;
  if (!match) {
    throw new Error(`No billing cycle contains ${date}`);
  }
  return applyOverride(match, overrides);
}

export function upcomingCycles(
  fromDate: string,
  count: number,
  config: CycleConfig,
  overrides: CycleOverride[] = [],
): Cycle[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('cycle count must be a positive integer');
  }
  const cycles: Cycle[] = [];
  let cursor = fromDate;
  let steps = 0;
  while (cycles.length < count) {
    steps += 1;
    if (steps > count * 40) {
      throw new Error('billing cycles did not advance');
    }
    const next = resolveCycle(cursor, config, overrides);
    const previous = cycles[cycles.length - 1];
    if (!previous || previous.referenceMonth !== next.referenceMonth) {
      cycles.push(next);
    }
    const nextCursor = addDays(next.cycleEnd, 1);
    if (nextCursor <= cursor) {
      throw new Error('billing cycles did not advance');
    }
    cursor = nextCursor;
  }
  return cycles;
}

/** Calendar date of an instant in a card's timezone. Dates are `YYYY-MM-DD`. */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  if (!year || !month || !day) {
    throw new Error(`could not format ${instant.toISOString()} in ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}
