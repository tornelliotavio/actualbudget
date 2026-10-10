import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { AlignedText } from '@actual-app/components/aligned-text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { css } from '@emotion/css';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { FinancialText } from '#components/FinancialText';
import { useRechartsAnimation } from '#components/reports/chart-theme';
import { Container } from '#components/reports/Container';
import { LegendItem } from '#components/reports/LegendItem';
import type { CardBill, CardBillStatus } from '#credit-cards';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';
import { usePrivacyMode } from '#hooks/usePrivacyMode';

import { statusChartColor, StatusLabel, useCardDates } from './ui';

type Datum = {
  referenceMonth: string;
  label: string;
  paid: number;
  remaining: number;
  owed: number;
  status: CardBillStatus;
};

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: Datum }>;
};

function BillTooltip({ active, payload }: TooltipProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const dates = useCardDates();
  const datum = payload?.[0]?.payload;
  if (!active || !datum) {
    return null;
  }
  return (
    <div
      className={css({
        pointerEvents: 'none',
        borderRadius: 2,
        boxShadow: '0 1px 6px rgba(0, 0, 0, .20)',
        backgroundColor: theme.menuBackground,
        color: theme.menuItemText,
        padding: 10,
        minWidth: 180,
      })}
    >
      <div style={{ marginBottom: 8 }}>
        <strong>{dates.month(datum.referenceMonth)}</strong>
      </div>
      <div style={{ lineHeight: 1.5 }}>
        <AlignedText
          left={t('Status:')}
          right={<StatusLabel status={datum.status} />}
        />
        <AlignedText
          left={t('Bill:')}
          right={
            <FinancialText as="strong">
              {format(datum.owed, 'financial')}
            </FinancialText>
          }
        />
        <AlignedText
          left={t('Paid:')}
          right={
            <FinancialText>{format(datum.paid, 'financial')}</FinancialText>
          }
        />
        <AlignedText
          left={t('Left to pay:')}
          right={
            <FinancialText>
              {format(datum.remaining, 'financial')}
            </FinancialText>
          }
        />
      </div>
    </div>
  );
}

export function BillsChart({
  cardId,
  bills,
}: {
  cardId: string;
  bills: CardBill[];
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const dates = useCardDates();
  const privacyMode = usePrivacyMode();
  const [yAxisIsHovered, setYAxisIsHovered] = useState(false);
  const animationProps = useRechartsAnimation({ animationDuration: 600 });

  const data: Datum[] = bills
    .filter(bill => !bill.cancelled)
    .slice(-13)
    .map(bill => ({
      referenceMonth: bill.referenceMonth,
      label: dates.shortMonth(bill.referenceMonth),
      paid: Math.min(bill.amountPaid, bill.amountOwed),
      remaining: Math.max(bill.remaining, 0),
      owed: bill.amountOwed,
      status: bill.status,
    }));

  if (data.length === 0) {
    return (
      <View style={{ color: theme.pageTextSubdued, padding: 20 }}>
        <Trans>No bills yet.</Trans>
      </View>
    );
  }

  const openBill = (datum: Datum | undefined) => {
    if (datum) {
      void navigate(`/credit-cards/${cardId}/bills/${datum.referenceMonth}`);
    }
  };

  return (
    <View>
      <Container style={{ height: 240 }}>
        {(width, height) => (
          <BarChart
            responsive
            width={width}
            height={height}
            data={data}
            margin={{ top: 10, right: 10, bottom: 0, left: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: theme.reportsLabel, fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: theme.reportsLabel, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={value =>
                privacyMode && !yAxisIsHovered
                  ? '...'
                  : format(value, 'financial-no-decimals')
              }
              onMouseEnter={() => setYAxisIsHovered(true)}
              onMouseLeave={() => setYAxisIsHovered(false)}
            />
            <Tooltip
              content={<BillTooltip />}
              cursor={{ fill: theme.tableRowBackgroundHover }}
              isAnimationActive={false}
            />
            <Bar
              dataKey="paid"
              stackId="bill"
              fill={theme.reportsGreen}
              maxBarSize={36}
              cursor="pointer"
              onClick={(_, index) => openBill(data[index])}
              {...animationProps}
            />
            <Bar
              dataKey="remaining"
              stackId="bill"
              maxBarSize={36}
              radius={[3, 3, 0, 0]}
              cursor="pointer"
              onClick={(_, index) => openBill(data[index])}
              {...animationProps}
            >
              {data.map(datum => (
                <Cell
                  key={datum.referenceMonth}
                  fill={statusChartColor(datum.status)}
                />
              ))}
            </Bar>
          </BarChart>
        )}
      </Container>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          fontSize: 12,
          color: theme.pageTextLight,
        }}
      >
        <LegendItem color={theme.reportsGreen} label={t('Paid')} />
        <LegendItem
          color={statusChartColor('closed')}
          label={t('Waiting for payment')}
        />
        <LegendItem color={statusChartColor('overdue')} label={t('Overdue')} />
        <LegendItem color={statusChartColor('open')} label={t('Still open')} />
      </View>
    </View>
  );
}
