import { addDays, parseDate } from '#shared/months';

import type { DateString } from './types';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(year: number, month: number, day: number): DateString {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Gregorian Easter Sunday (Meeus/Jones/Butcher). */
export function easterSunday(year: number): DateString {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

const FIXED_BANK_HOLIDAYS = [
  [1, 1],
  [4, 21],
  [5, 1],
  [9, 7],
  [10, 12],
  [11, 2],
  [11, 15],
  [11, 20],
  [12, 25],
  // No banking hours for the public; bills due that day move to the next
  // business day like on a holiday.
  [12, 31],
] as const;

const holidayCache = new Map<number, Set<DateString>>();

/**
 * Days Brazilian banks are closed to the public (FEBRABAN calendar): national
 * holidays, Carnival Monday and Tuesday, Good Friday, Corpus Christi and
 * December 31st.
 */
export function bankHolidays(year: number): Set<DateString> {
  const cached = holidayCache.get(year);
  if (cached) {
    return cached;
  }
  const easter = easterSunday(year);
  const holidays = new Set<DateString>([
    ...FIXED_BANK_HOLIDAYS.map(([month, day]) => isoDate(year, month, day)),
    addDays(easter, -48),
    addDays(easter, -47),
    addDays(easter, -2),
    addDays(easter, 60),
  ]);
  holidayCache.set(year, holidays);
  return holidays;
}

export function isBusinessDay(date: DateString): boolean {
  const weekday = parseDate(date).getDay();
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  return !bankHolidays(Number(date.slice(0, 4))).has(date);
}

export function nextBusinessDay(date: DateString): DateString {
  let current = date;
  while (!isBusinessDay(current)) {
    current = addDays(current, 1);
  }
  return current;
}
