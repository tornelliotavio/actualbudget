import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { BudgetDailySpendingRow } from '@actual-app/core/shared/budget-spending';
import * as monthUtils from '@actual-app/core/shared/months';
import type { CategoryGroupEntity } from '@actual-app/core/types/models';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { FinancialText } from '#components/FinancialText';
import { buildCumulative } from '#components/home/spending/spendingModel';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useRechartsAnimation } from '#components/reports/chart-theme';
import { ChartTooltip } from '#components/reports/ChartTooltip';
import { Container } from '#components/reports/Container';
import { getCustomTick } from '#components/reports/getCustomTick';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { usePrivacyMode } from '#hooks/usePrivacyMode';

type CumulativeSpendingChartProps = {
  rows: readonly BudgetDailySpendingRow[];
  groups: readonly CategoryGroupEntity[];
  month: string;
  today: string;
};

/** Spending so far in the month, day by day, against the month before. */
export function CumulativeSpendingChart({
  rows,
  groups,
  month,
  today,
}: CumulativeSpendingChartProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const privacyMode = usePrivacyMode();
  const animation = useRechartsAnimation();
  const { isNarrowWidth } = useResponsive();
  const [showTable, setShowTable] = useState(false);

  const points = buildCumulative({ rows, groups, month, today });
  const previousMonth = monthUtils.subMonths(month, 1);
  const currentName = monthUtils.format(month, 'MMMM', locale);
  const previousName = monthUtils.format(previousMonth, 'MMMM', locale);

  const lastCurrent = [...points]
    .reverse()
    .find(point => point.current != null);
  const sameDayPrevious = lastCurrent
    ? points[lastCurrent.day - 1]?.previous
    : null;
  const difference =
    lastCurrent?.current != null && sameDayPrevious != null
      ? lastCurrent.current - sameDayPrevious
      : null;

  const series = [
    {
      key: 'current',
      name: currentName,
      color: theme.reportsBlue,
      dash: undefined,
    },
    {
      key: 'previous',
      name: previousName,
      color: theme.reportsGray,
      dash: '5 4',
    },
  ] as const;

  return (
    <View style={{ gap: 10, minWidth: 0 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {series.map(line => (
          <View
            key={line.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <svg width={18} height={8} aria-hidden>
              <line
                x1={0}
                x2={18}
                y1={4}
                y2={4}
                stroke={line.color}
                strokeWidth={2}
                strokeDasharray={line.dash}
              />
            </svg>
            <Text style={styles.smallText}>{line.name}</Text>
          </View>
        ))}
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
          {points
            .filter(point => point.current != null || point.previous != null)
            .map(point => (
              <View
                key={point.day}
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  padding: '3px 0',
                  borderTop: `1px solid ${theme.tableBorder}`,
                }}
              >
                <Text style={{ width: 40 }}>{point.day}</Text>
                <PrivacyFilter>
                  <FinancialText style={{ flex: 1, textAlign: 'right' }}>
                    {point.current == null
                      ? '-'
                      : format(point.current, 'financial')}
                  </FinancialText>
                </PrivacyFilter>
                <PrivacyFilter>
                  <FinancialText
                    style={{
                      flex: 1,
                      textAlign: 'right',
                      color: theme.pageTextSubdued,
                    }}
                  >
                    {point.previous == null
                      ? '-'
                      : format(point.previous, 'financial')}
                  </FinancialText>
                </PrivacyFilter>
              </View>
            ))}
        </View>
      ) : (
        <Container style={{ height: isNarrowWidth ? 200 : 240 }}>
          {(width, height) => (
            <LineChart
              width={width}
              height={height}
              data={points}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              accessibilityLayer
              title={t('Spending so far')}
            >
              <CartesianGrid
                vertical={false}
                stroke={theme.tableBorder}
                strokeDasharray="0"
              />
              <XAxis
                dataKey="day"
                tick={{ fill: theme.pageTextSubdued, fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: theme.tableBorder }}
                interval="preserveStartEnd"
                minTickGap={16}
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
                cursor={{ stroke: theme.pageTextSubdued, strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as
                    | (typeof points)[number]
                    | undefined;
                  if (!active || !point) {
                    return null;
                  }
                  return (
                    <ChartTooltip
                      title={t('Day {{day}}', { day: point.day })}
                      rows={series
                        .filter(line => point[line.key] != null)
                        .map(line => ({
                          label: line.name,
                          value: format(point[line.key] ?? 0, 'financial'),
                          color: line.color,
                        }))}
                    />
                  );
                }}
              />
              {series.map(line => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.name}
                  stroke={line.color}
                  strokeWidth={2}
                  strokeDasharray={line.dash}
                  dot={false}
                  activeDot={{
                    r: 4,
                    strokeWidth: 2,
                    stroke: theme.tableBackground,
                  }}
                  connectNulls={false}
                  {...animation}
                />
              ))}
            </LineChart>
          )}
        </Container>
      )}
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {difference != null && lastCurrent && (
          <PrivacyFilter>
            {difference > 0
              ? t('{{amount}} more than {{month}} by day {{day}}.', {
                  amount: format(difference, 'financial'),
                  month: previousName,
                  day: lastCurrent.day,
                })
              : t('{{amount}} less than {{month}} by day {{day}}.', {
                  amount: format(-difference, 'financial'),
                  month: previousName,
                  day: lastCurrent.day,
                })}{' '}
          </PrivacyFilter>
        )}
        <Trans>Card purchases count on their bill's due day.</Trans>
      </Text>
    </View>
  );
}
