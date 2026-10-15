import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Menu } from '@actual-app/components/menu';
import { ModeButton } from '@actual-app/components/mode-button';
import { Select } from '@actual-app/components/select';
import type { SelectOption } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { BudgetSpendingRow } from '@actual-app/core/shared/budget-spending';
import * as monthUtils from '@actual-app/core/shared/months';
import type { CategoryGroupEntity } from '@actual-app/core/types/models';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { FinancialText } from '#components/FinancialText';
import { buildMonthlyTrend } from '#components/home/spending/spendingModel';
import type { TrendFilter } from '#components/home/spending/spendingModel';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useRechartsAnimation } from '#components/reports/chart-theme';
import { ChartTooltip } from '#components/reports/ChartTooltip';
import { Container } from '#components/reports/Container';
import { getCustomTick } from '#components/reports/getCustomTick';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useLocalPref } from '#hooks/useLocalPref';
import { usePrivacyMode } from '#hooks/usePrivacyMode';

type MonthlySpendingChartProps = {
  rows: readonly BudgetSpendingRow[];
  groups: readonly CategoryGroupEntity[];
  month: string;
  onSelectMonth: (month: string) => void;
};

function filterKey(filter: TrendFilter) {
  return filter.type === 'all' ? 'all' : `${filter.type}:${filter.id}`;
}

function parseFilterKey(key: string): TrendFilter {
  const [type, id] = key.split(':');
  return type === 'group' || type === 'category'
    ? { type, id }
    : { type: 'all' };
}

/** Spending per budget month, for all expenses or one group or category. */
export function MonthlySpendingChart({
  rows,
  groups,
  month,
  onSelectMonth,
}: MonthlySpendingChartProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const privacyMode = usePrivacyMode();
  const animation = useRechartsAnimation();
  const { isNarrowWidth } = useResponsive();
  const [range = 6, setRange] = useLocalPref('home.trendRange');
  const [storedFilter, setFilter] = useLocalPref('home.trendFilter');
  const [showTable, setShowTable] = useState(false);

  const filter = storedFilter ?? { type: 'all' };
  const months = Array.from({ length: range }, (_, index) =>
    monthUtils.subMonths(month, range - 1 - index),
  );
  const points = buildMonthlyTrend({ rows, groups, months, filter });
  const average = Math.round(
    points.reduce((sum, point) => sum + point.spent, 0) /
      Math.max(points.length, 1),
  );
  const data = points.map(point => ({
    ...point,
    label: monthUtils.format(point.month, 'MMM', locale),
  }));

  const expenseGroups = groups.filter(
    group => !group.is_income && !group.hidden,
  );
  const option = (value: string, label: string): SelectOption => [value, label];
  const options: SelectOption[] = [
    option('all', t('All spending')),
    Menu.line,
    ...expenseGroups.flatMap<SelectOption>(group => [
      option(`group:${group.id}`, group.name),
      ...(group.categories ?? [])
        .filter(category => !category.hidden)
        .map(category =>
          option(`category:${category.id}`, `  ${category.name}`),
        ),
    ]),
  ];

  return (
    <View style={{ gap: 10, minWidth: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Select
          value={filterKey(filter)}
          onChange={key => setFilter(parseFilterKey(key))}
          options={options}
          style={{ minWidth: 160, maxWidth: 240 }}
        />
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {([6, 12] as const).map(length => (
            <ModeButton
              key={length}
              selected={range === length}
              onSelect={() => setRange(length)}
            >
              {t('{{count}} months', { count: length })}
            </ModeButton>
          ))}
        </View>
        <Button
          variant="bare"
          onPress={() => setShowTable(!showTable)}
          style={{ marginLeft: 'auto', ...styles.smallText }}
        >
          {showTable ? <Trans>Show chart</Trans> : <Trans>Show as table</Trans>}
        </Button>
      </View>

      {showTable ? (
        <View>
          {data.map(point => (
            <View
              key={point.month}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                padding: '4px 0',
                borderTop: `1px solid ${theme.tableBorder}`,
                fontWeight: point.month === month ? 600 : 400,
              }}
            >
              <Text>{monthUtils.format(point.month, 'MMMM yyyy', locale)}</Text>
              <PrivacyFilter>
                <FinancialText>
                  {format(point.spent, 'financial')}
                </FinancialText>
              </PrivacyFilter>
            </View>
          ))}
        </View>
      ) : (
        <Container style={{ height: isNarrowWidth ? 200 : 240 }}>
          {(width, height) => (
            <BarChart
              width={width}
              height={height}
              data={data}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              accessibilityLayer
              title={t('Spending per month')}
            >
              <CartesianGrid
                vertical={false}
                stroke={theme.tableBorder}
                strokeDasharray="0"
              />
              <XAxis
                dataKey="label"
                tick={{ fill: theme.pageTextSubdued, fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: theme.tableBorder }}
              />
              <YAxis
                width={isNarrowWidth ? 48 : 64}
                tickFormatter={value =>
                  getCustomTick(
                    format(value, 'financial-no-decimals'),
                    privacyMode,
                  )
                }
                tick={{ fill: theme.pageTextSubdued, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: theme.tableRowBackgroundHover }}
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as
                    | (typeof data)[number]
                    | undefined;
                  if (!active || !point) {
                    return null;
                  }
                  return (
                    <ChartTooltip
                      title={monthUtils.format(
                        point.month,
                        'MMMM yyyy',
                        locale,
                      )}
                      rows={[
                        {
                          label: t('Spent'),
                          value: format(point.spent, 'financial'),
                          color: theme.reportsBlue,
                        },
                        {
                          label: t('Average'),
                          value: format(average, 'financial'),
                          color: theme.reportsGray,
                        },
                      ]}
                    />
                  );
                }}
              />
              <ReferenceLine
                y={average}
                stroke={theme.reportsGray}
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
              <Bar
                dataKey="spent"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
                onClick={entry => {
                  const clicked = (entry as { payload?: { month?: string } })
                    .payload?.month;
                  if (clicked) {
                    onSelectMonth(clicked);
                  }
                }}
                style={{ cursor: 'pointer' }}
                {...animation}
              >
                {data.map(point => (
                  <Cell
                    key={point.month}
                    fill={theme.reportsBlue}
                    fillOpacity={point.month === month ? 1 : 0.45}
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </Container>
      )}
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        <PrivacyFilter>
          {t(
            'Average of these months: {{amount}}. The selected month is highlighted.',
            {
              amount: format(average, 'financial'),
            },
          )}
        </PrivacyFilter>
      </Text>
    </View>
  );
}
