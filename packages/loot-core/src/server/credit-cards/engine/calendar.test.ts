import {
  bankHolidays,
  easterSunday,
  isBusinessDay,
  nextBusinessDay,
} from './calendar';

describe('bank calendar', () => {
  it('computes Easter Sunday', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });

  it('includes the movable bank holidays', () => {
    const holidays = bankHolidays(2027);
    expect(holidays.has('2027-02-08')).toBe(true);
    expect(holidays.has('2027-02-09')).toBe(true);
    expect(holidays.has('2027-03-26')).toBe(true);
    expect(holidays.has('2027-05-27')).toBe(true);
  });

  it('includes Black Consciousness Day and December 31st', () => {
    const holidays = bankHolidays(2026);
    expect(holidays.has('2026-11-20')).toBe(true);
    expect(holidays.has('2026-12-31')).toBe(true);
  });

  it('skips weekends and holidays', () => {
    expect(isBusinessDay('2026-11-12')).toBe(true);
    expect(isBusinessDay('2026-12-12')).toBe(false);
    expect(nextBusinessDay('2026-12-12')).toBe('2026-12-14');
    // Saturday, then Sunday, then the October 12th holiday.
    expect(nextBusinessDay('2026-10-10')).toBe('2026-10-13');
    expect(nextBusinessDay('2026-11-12')).toBe('2026-11-12');
  });
});
