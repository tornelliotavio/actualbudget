import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { ModeButton } from '@actual-app/components/mode-button';
import { View } from '@actual-app/components/view';
import type {
  BudgetDailySpendingRow,
  BudgetSpendingRow,
} from '@actual-app/core/shared/budget-spending';
import type { CategoryGroupEntity } from '@actual-app/core/types/models';

import { HomeSection } from '#components/home/HomeSection';

import { CumulativeSpendingChart } from './CumulativeSpendingChart';
import { MonthlySpendingChart } from './MonthlySpendingChart';

type ChartsSectionProps = {
  rows: readonly BudgetSpendingRow[];
  dailyRows: readonly BudgetDailySpendingRow[];
  groups: readonly CategoryGroupEntity[];
  month: string;
  today: string;
  onSelectMonth: (month: string) => void;
};

type ChartView = 'monthly' | 'cumulative';

/**
 * Spending over time: month by month, and day by day within the month. Side
 * by side on wide screens, one at a time on phones.
 */
export function ChartsSection({
  rows,
  dailyRows,
  groups,
  month,
  today,
  onSelectMonth,
}: ChartsSectionProps) {
  const { t } = useTranslation();
  const { isNarrowWidth, isWideWidth } = useResponsive();
  const [view, setView] = useState<ChartView>('monthly');

  const monthly = (
    <MonthlySpendingChart
      rows={rows}
      groups={groups}
      month={month}
      onSelectMonth={onSelectMonth}
    />
  );
  const cumulative = (
    <CumulativeSpendingChart
      rows={dailyRows}
      groups={groups}
      month={month}
      today={today}
    />
  );

  if (isNarrowWidth) {
    return (
      <HomeSection
        id="charts"
        title={t('Spending over time')}
        action={
          <View style={{ flexDirection: 'row', gap: 2 }}>
            <ModeButton
              selected={view === 'monthly'}
              onSelect={() => setView('monthly')}
            >
              <Trans>Monthly</Trans>
            </ModeButton>
            <ModeButton
              selected={view === 'cumulative'}
              onSelect={() => setView('cumulative')}
            >
              <Trans>This month</Trans>
            </ModeButton>
          </View>
        }
      >
        {view === 'monthly' ? monthly : cumulative}
      </HomeSection>
    );
  }

  return (
    <View
      style={{
        display: 'grid',
        gridTemplateColumns: isWideWidth ? '1fr 1fr' : '1fr',
        gap: 16,
      }}
    >
      <HomeSection id="trend" title={t('Spending per month')}>
        {monthly}
      </HomeSection>
      <HomeSection id="cumulative" title={t('Spending so far this month')}>
        {cumulative}
      </HomeSection>
    </View>
  );
}
