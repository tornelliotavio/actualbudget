import { useTranslation } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import * as monthUtils from '@actual-app/core/shared/months';
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

import { useRechartsAnimation } from '#components/reports/chart-theme';
import { ChartTooltip } from '#components/reports/ChartTooltip';
import { Container } from '#components/reports/Container';
import { getCustomTick } from '#components/reports/getCustomTick';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { usePrivacyMode } from '#hooks/usePrivacyMode';

import { getBillStatusLabel } from './billStatus';
import type { BillTrendPoint } from './billTrend';

type BillHistoryChartProps = {
  points: readonly BillTrendPoint[];
  selectedMonth: string;
  /** Average of the past bills, drawn as a dashed line. */
  average: number | null;
  height: number;
  onSelectMonth: (month: string) => void;
};

/**
 * Bill totals side by side, projected installments stacked on top of what is
 * already on the card. Clicking a bar selects that bill.
 */
export function BillHistoryChart({
  points,
  selectedMonth,
  average,
  height,
  onSelectMonth,
}: BillHistoryChartProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const privacyMode = usePrivacyMode();
  const animation = useRechartsAnimation();

  const data = points.map(point => ({
    ...point,
    label: monthUtils.format(point.month, 'MMM', locale),
  }));
  const selectBar = (entry: unknown) => {
    const month = (entry as { payload?: { month?: string } }).payload?.month;
    if (month) {
      onSelectMonth(month);
    }
  };

  return (
    <Container style={{ height }}>
      {(width, chartHeight) => (
        <BarChart
          width={width}
          height={chartHeight}
          data={data}
          margin={{ top: 6, right: 4, left: 0, bottom: 0 }}
          accessibilityLayer
          title={t('Recent bills')}
        >
          <CartesianGrid
            vertical={false}
            stroke={theme.tableBorder}
            strokeDasharray="0"
          />
          <XAxis
            dataKey="label"
            tick={{ fill: theme.pageTextSubdued, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: theme.tableBorder }}
          />
          <YAxis
            width={52}
            tickCount={4}
            tickFormatter={value =>
              getCustomTick(format(value, 'financial-no-decimals'), privacyMode)
            }
            tick={{ fill: theme.pageTextSubdued, fontSize: 11 }}
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
                  title={`${t('{{month}} bill', {
                    month: monthUtils.format(point.month, 'MMMM yyyy', locale),
                  })} · ${getBillStatusLabel(point.status, t)}`}
                  rows={[
                    ...(point.posted !== 0 || point.projected === 0
                      ? [
                          {
                            label: t('On the card'),
                            value: format(point.posted, 'financial'),
                            color: theme.reportsBlue,
                          },
                        ]
                      : []),
                    ...(point.projected !== 0
                      ? [
                          {
                            label: t('Projected installments'),
                            value: format(point.projected, 'financial'),
                            color: theme.reportsGray,
                          },
                        ]
                      : []),
                    {
                      label: t('Total'),
                      value: format(point.total, 'financial'),
                      color: 'transparent',
                    },
                  ]}
                />
              );
            }}
          />
          {average != null && (
            <ReferenceLine
              y={average}
              stroke={theme.reportsGray}
              strokeDasharray="4 4"
              strokeWidth={1.5}
            />
          )}
          <Bar
            dataKey="posted"
            stackId="bill"
            maxBarSize={32}
            onClick={selectBar}
            style={{ cursor: 'pointer' }}
            {...animation}
          >
            {data.map(point => (
              <Cell
                key={point.month}
                fill={theme.reportsBlue}
                fillOpacity={point.month === selectedMonth ? 1 : 0.45}
              />
            ))}
          </Bar>
          <Bar
            dataKey="projected"
            stackId="bill"
            maxBarSize={32}
            radius={[3, 3, 0, 0]}
            onClick={selectBar}
            style={{ cursor: 'pointer' }}
            {...animation}
          >
            {data.map(point => (
              <Cell
                key={point.month}
                fill={theme.reportsGray}
                fillOpacity={point.month === selectedMonth ? 0.9 : 0.4}
              />
            ))}
          </Bar>
        </BarChart>
      )}
    </Container>
  );
}
