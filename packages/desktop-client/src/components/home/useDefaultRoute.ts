import { useSyncedPref } from '#hooks/useSyncedPref';

/**
 * The page the app opens on. A tracking budget is not budgeted month by
 * month, so it opens on the overview of bills and spending; an envelope
 * budget opens on the budget.
 */
export function useDefaultRoute() {
  const [budgetType = 'envelope'] = useSyncedPref('budgetType');
  return budgetType === 'tracking' ? '/home' : '/budget';
}
