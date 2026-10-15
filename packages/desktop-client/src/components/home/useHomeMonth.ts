import { useSearchParams } from 'react-router';

import * as monthUtils from '@actual-app/core/shared/months';

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/**
 * The month the overview shows, kept in the URL so going back from a
 * drill-down returns to it. Defaults to the current month.
 */
export function useHomeMonth() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentMonth = monthUtils.currentMonth();
  const param = searchParams.get('month');
  const month = param && MONTH_PATTERN.test(param) ? param : currentMonth;

  const setMonth = (next: string) => {
    setSearchParams(
      params => {
        if (next === currentMonth) {
          params.delete('month');
        } else {
          params.set('month', next);
        }
        return params;
      },
      { replace: true },
    );
  };

  return {
    month,
    isCurrentMonth: month === currentMonth,
    isPastMonth: month < currentMonth,
    setMonth,
    previous: () => setMonth(monthUtils.subMonths(month, 1)),
    next: () => setMonth(monthUtils.addMonths(month, 1)),
    today: () => setMonth(currentMonth),
  };
}
