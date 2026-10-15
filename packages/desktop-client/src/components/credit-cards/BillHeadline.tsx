import { useTranslation } from 'react-i18next';

import {
  SvgArrowThinDown,
  SvgArrowThinUp,
} from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CardBill } from '@actual-app/core/server/credit-cards/bills';
import type { TFunction } from 'i18next';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import type { BillComparison } from './billTrend';

/** Below this share of the average, a bill counts as in line with it. */
const IN_LINE_RATIO = 0.05;

type BillHeadlineProps = {
  bill: CardBill;
  comparison: BillComparison | null;
};

/** The bill's total, and how it compares with the bills before it. */
export function BillHeadline({ bill, comparison }: BillHeadlineProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const isSettled = bill.status !== 'open' && bill.status !== 'upcoming';
  const trend =
    comparison?.ratio == null || bill.status === 'upcoming'
      ? null
      : isSettled
        ? getTrend(comparison.ratio)
        : 'so-far';
  const TrendIcon =
    trend === 'above'
      ? SvgArrowThinUp
      : trend === 'below'
        ? SvgArrowThinDown
        : null;

  return (
    <View style={{ gap: 2 }}>
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {isSettled ? t('Bill total') : t('Total so far')}
      </Text>
      <PrivacyFilter>
        <FinancialText
          style={{ fontSize: 24, fontWeight: 600, color: theme.pageText }}
        >
          {format(bill.total, 'financial')}
        </FinancialText>
      </PrivacyFilter>
      {comparison && trend && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {TrendIcon && (
            <TrendIcon
              width={10}
              height={10}
              style={{ color: theme.pageTextSubdued, flexShrink: 0 }}
            />
          )}
          <PrivacyFilter>
            <Text
              style={{
                ...styles.smallText,
                ...styles.tnum,
                color: theme.pageTextSubdued,
              }}
            >
              {getComparisonText(
                trend,
                comparison,
                format(comparison.average, 'financial'),
                t,
              )}
            </Text>
          </PrivacyFilter>
        </View>
      )}
    </View>
  );
}

type Trend = 'above' | 'below' | 'in-line' | 'so-far';

function getTrend(ratio: number): Trend {
  if (Math.abs(ratio) < IN_LINE_RATIO) {
    return 'in-line';
  }
  return ratio > 0 ? 'above' : 'below';
}

function getComparisonText(
  trend: Trend,
  { ratio }: BillComparison,
  average: string,
  t: TFunction,
) {
  const percent = Math.round(Math.abs(ratio ?? 0) * 100);
  switch (trend) {
    case 'above':
      return t(
        '{{percent}}% above the average of previous bills ({{average}})',
        {
          percent,
          average,
        },
      );
    case 'below':
      return t(
        '{{percent}}% below the average of previous bills ({{average}})',
        {
          percent,
          average,
        },
      );
    case 'in-line':
      return t('In line with the average of previous bills ({{average}})', {
        average,
      });
    case 'so-far':
      return t('{{percent}}% of the average of previous bills ({{average}})', {
        percent: Math.round(((ratio ?? 0) + 1) * 100),
        average,
      });
    default:
      return trend satisfies never;
  }
}
