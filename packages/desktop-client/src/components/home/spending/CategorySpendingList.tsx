import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import {
  SvgCheveronDown,
  SvgCheveronRight,
} from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';
import type { TFunction } from 'i18next';

import { Link } from '#components/common/Link';
import { FinancialText } from '#components/FinancialText';
import { HomeSection } from '#components/home/HomeSection';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';
import { useLocalPref } from '#hooks/useLocalPref';
import { useShowCategoryActivity } from '#hooks/useShowCategoryActivity';

import type {
  CategorySpending,
  GroupSpending,
  MonthSpending,
} from './spendingModel';

type CategorySpendingListProps = {
  spending: MonthSpending;
  month: string;
  /** Share of the month gone by, for the month in progress. */
  monthProgress: number | null;
  uncategorizedCount: number;
  isLoading: boolean;
};

function hasActivity(row: CategorySpending) {
  return row.amount !== 0 || (row.average ?? 0) !== 0;
}

/**
 * Spending per group and category in the budget month, against the average
 * of the three months before. Rows open the transactions behind them.
 */
export function CategorySpendingList({
  spending,
  month,
  monthProgress,
  uncategorizedCount,
  isLoading,
}: CategorySpendingListProps) {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const [collapsed = [], setCollapsed] = useLocalPref('home.collapsed');
  const [showHidden = false] = useLocalPref('budget.showHiddenCategories');
  const [showEmpty, setShowEmpty] = useState(false);
  const showActivity = useShowCategoryActivity();

  const visible = (row: CategorySpending) =>
    (showHidden || !row.hidden) && (showEmpty || hasActivity(row));
  const groupsOf = (groups: GroupSpending[]) =>
    groups
      .filter(group => showHidden || !group.hidden)
      .map(group => ({
        ...group,
        categories: group.categories.filter(visible),
      }))
      .filter(group => showEmpty || hasActivity(group));

  const expenseGroups = groupsOf(spending.expenseGroups);
  const incomeGroups = groupsOf(spending.incomeGroups);
  const hiddenEmptyCount = [
    ...spending.expenseGroups,
    ...spending.incomeGroups,
  ].reduce(
    (count, group) =>
      count +
      group.categories.filter(
        category => (showHidden || !category.hidden) && !hasActivity(category),
      ).length,
    0,
  );

  const toggleGroup = (id: string) =>
    setCollapsed(
      collapsed.includes(id)
        ? collapsed.filter(group => group !== id)
        : [...collapsed, id],
    );

  const renderGroup = (group: GroupSpending) => {
    const isCollapsed = collapsed.includes(group.id);
    return (
      <View key={group.id}>
        <SpendingRow
          row={group}
          isGroup
          isIncome={group.isIncome}
          monthProgress={monthProgress}
          onPress={() => toggleGroup(group.id)}
          leading={
            isCollapsed ? (
              <SvgCheveronRight width={12} height={12} />
            ) : (
              <SvgCheveronDown width={12} height={12} />
            )
          }
          expanded={!isCollapsed}
          onShowActivity={
            isNarrowWidth
              ? undefined
              : () =>
                  showActivity(
                    group.categories.map(category => category.id),
                    month,
                  )
          }
        />
        {!isCollapsed &&
          group.categories.map(category => (
            <SpendingRow
              key={category.id}
              row={category}
              isIncome={group.isIncome}
              monthProgress={monthProgress}
              onPress={() => showActivity(category.id, month)}
            />
          ))}
      </View>
    );
  };

  return (
    <HomeSection
      id="spending"
      title={t('Spending by category')}
      action={
        <Link variant="internal" to="/budget" style={styles.smallText}>
          <Trans>Open budget</Trans>
        </Link>
      }
    >
      {!isNarrowWidth && (
        <View
          style={{
            flexDirection: 'row',
            gap: 12,
            ...styles.smallText,
            color: theme.pageTextSubdued,
            paddingRight: 4,
          }}
        >
          <Text style={{ flex: 1 }}>
            <Trans>Category</Trans>
          </Text>
          <Text style={{ width: 110, textAlign: 'right' }}>
            <Trans>Spent</Trans>
          </Text>
          <Text style={{ width: 110, textAlign: 'right' }}>
            <Trans>3-month average</Trans>
          </Text>
          <Text style={{ width: 150 }}>
            <Trans>Compared to average</Trans>
          </Text>
        </View>
      )}
      {isLoading && expenseGroups.length === 0 ? (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>Loading...</Trans>
        </Text>
      ) : (
        <View>
          {expenseGroups.length === 0 && (
            <Text style={{ color: theme.pageTextSubdued, padding: '8px 0' }}>
              <Trans>No spending in this month.</Trans>
            </Text>
          )}
          {expenseGroups.map(renderGroup)}
          <TotalRow
            label={t('Total spent')}
            amount={spending.spent}
            average={spending.spentAverage}
          />
          {incomeGroups.length > 0 && (
            <>
              <Text
                style={{
                  ...styles.smallText,
                  color: theme.pageTextSubdued,
                  padding: '14px 0 4px',
                }}
              >
                <Trans>Income</Trans>
              </Text>
              {incomeGroups.map(renderGroup)}
            </>
          )}
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: '4px 16px',
          ...styles.smallText,
        }}
      >
        {uncategorizedCount > 0 && (
          <Link
            variant="internal"
            to="/categories/uncategorized"
            style={{ color: theme.warningText }}
          >
            {t('{{count}} transactions without a category', {
              count: uncategorizedCount,
            })}
          </Link>
        )}
        {(hiddenEmptyCount > 0 || showEmpty) && (
          <Button
            variant="bare"
            onPress={() => setShowEmpty(!showEmpty)}
            style={{ padding: 0, color: theme.pageTextSubdued }}
          >
            {showEmpty
              ? t('Hide categories without spending')
              : t('Show {{count}} categories without spending', {
                  count: hiddenEmptyCount,
                })}
          </Button>
        )}
      </View>
    </HomeSection>
  );
}

type SpendingRowProps = {
  row: CategorySpending;
  isGroup?: boolean;
  isIncome: boolean;
  monthProgress: number | null;
  onPress: () => void;
  leading?: ReactNode;
  expanded?: boolean;
  onShowActivity?: () => void;
};

function SpendingRow({
  row,
  isGroup = false,
  isIncome,
  monthProgress,
  onPress,
  leading,
  expanded,
  onShowActivity,
}: SpendingRowProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const { isNarrowWidth } = useResponsive();
  const comparison = getComparison(row, t);

  const name = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
        paddingLeft: isGroup ? 0 : 18,
      }}
    >
      {leading}
      <Text
        style={{
          fontWeight: isGroup ? 600 : 400,
          ...styles.lineClamp(1),
          color: row.hidden ? theme.pageTextSubdued : theme.pageText,
        }}
      >
        {row.name}
      </Text>
    </View>
  );
  const amount = (
    <PrivacyFilter>
      <FinancialText
        style={{
          fontWeight: isGroup ? 600 : 500,
          color: isIncome ? theme.reportsNumberPositive : theme.pageText,
        }}
      >
        {format(row.amount, 'financial')}
      </FinancialText>
    </PrivacyFilter>
  );
  const label = t('{{name}}: {{amount}}, {{comparison}}', {
    name: row.name,
    amount: format(row.amount, 'financial'),
    comparison: comparison.text,
  });

  return (
    <View
      style={{
        borderTop: `1px solid ${theme.tableBorder}`,
        backgroundColor: isGroup ? theme.tableRowHeaderBackground : undefined,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Button
        variant="bare"
        onPress={onPress}
        aria-label={label}
        aria-expanded={expanded}
        style={{
          flex: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          textAlign: 'left',
          padding: isNarrowWidth ? '10px 4px' : '6px 4px',
          minHeight: isNarrowWidth ? 48 : 34,
          borderRadius: 0,
        }}
      >
        {isNarrowWidth ? (
          <View style={{ flex: 1, gap: 4 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              {name}
              {amount}
            </View>
            {!isIncome && (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
              >
                <ComparisonBar
                  row={row}
                  monthProgress={monthProgress}
                  style={{ flex: 1 }}
                />
                <Text
                  style={{
                    ...styles.smallText,
                    color: comparison.color,
                    minWidth: 96,
                    textAlign: 'right',
                  }}
                >
                  {comparison.text}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              flex: 1,
            }}
          >
            {name}
            <View style={{ width: 110, alignItems: 'flex-end' }}>{amount}</View>
            <View style={{ width: 110, alignItems: 'flex-end' }}>
              <PrivacyFilter>
                <FinancialText style={{ color: theme.pageTextSubdued }}>
                  {row.average == null ? '-' : format(row.average, 'financial')}
                </FinancialText>
              </PrivacyFilter>
            </View>
            <View
              style={{
                width: 150,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {!isIncome && (
                <>
                  <ComparisonBar
                    row={row}
                    monthProgress={monthProgress}
                    style={{ width: 80 }}
                  />
                  <Text
                    style={{
                      ...styles.smallText,
                      color: comparison.color,
                      ...styles.lineClamp(1),
                    }}
                  >
                    {comparison.short}
                  </Text>
                </>
              )}
            </View>
          </View>
        )}
      </Button>
      {onShowActivity && (
        <Button
          variant="bare"
          onPress={onShowActivity}
          aria-label={t('View transactions of {{name}}', { name: row.name })}
          style={{
            ...styles.smallText,
            color: theme.pageTextLink,
            padding: '0 8px',
          }}
        >
          <Trans>View</Trans>
        </Button>
      )}
    </View>
  );
}

function getComparison(row: CategorySpending, t: TFunction) {
  if (row.average == null || row.average <= 0) {
    const text = row.amount > 0 ? t('No history') : '';
    return { text, short: text, color: theme.pageTextSubdued };
  }
  const percent = Math.round((row.amount / row.average) * 100);
  return {
    text: t('{{percent}}% of average', { percent }),
    short: t('{{percent}}%', { percent }),
    color: percent > 110 ? theme.warningText : theme.pageTextSubdued,
  };
}

type ComparisonBarProps = {
  row: CategorySpending;
  monthProgress: number | null;
  style?: CSSProperties;
};

/**
 * Spent against the average; the mark shows how much of the month has gone
 * by, so spending ahead of it is ahead of the usual pace.
 */
function ComparisonBar({ row, monthProgress, style }: ComparisonBarProps) {
  if (row.average == null || row.average <= 0) {
    return <View style={style} />;
  }
  const ratio = row.amount / row.average;
  const isOver = ratio > 1;
  return (
    <View
      aria-hidden
      style={{
        position: 'relative',
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.pillBackground,
        overflow: 'hidden',
        ...style,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.min(Math.max(ratio, 0), 1) * 100}%`,
          backgroundColor: isOver ? theme.warningText : theme.reportsBlue,
        }}
      />
      {monthProgress != null && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${monthProgress * 100}%`,
            width: 2,
            backgroundColor: theme.pageText,
            opacity: 0.6,
          }}
        />
      )}
    </View>
  );
}

function TotalRow({
  label,
  amount,
  average,
}: {
  label: string;
  amount: number;
  average: number | null;
}) {
  const format = useFormat();
  const { isNarrowWidth } = useResponsive();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: '8px 4px',
        borderTop: `2px solid ${theme.tableBorder}`,
        fontWeight: 600,
      }}
    >
      <Text style={{ flex: 1 }}>{label}</Text>
      <View
        style={{
          width: isNarrowWidth ? undefined : 110,
          alignItems: 'flex-end',
        }}
      >
        <PrivacyFilter>
          <FinancialText>{format(amount, 'financial')}</FinancialText>
        </PrivacyFilter>
      </View>
      {!isNarrowWidth && (
        <>
          <View style={{ width: 110, alignItems: 'flex-end' }}>
            <PrivacyFilter>
              <FinancialText style={{ color: theme.pageTextSubdued }}>
                {average == null ? '-' : format(average, 'financial')}
              </FinancialText>
            </PrivacyFilter>
          </View>
          <View style={{ width: 150 }} />
        </>
      )}
    </View>
  );
}

/** Share of `month` gone by on `today`; null for other months. */
export function getMonthProgress(month: string, today: string) {
  if (monthUtils.monthFromDate(today) !== month) {
    return null;
  }
  const day = Number(today.slice(8, 10));
  const days = Number(monthUtils.lastDayOfMonth(month).slice(8, 10));
  return day / days;
}
