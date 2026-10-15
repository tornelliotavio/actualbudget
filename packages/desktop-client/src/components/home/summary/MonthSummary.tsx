import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import type { HomeSummary } from './homeSummary';

type MonthSummaryProps = {
  summary: HomeSummary;
  spentAverage: number | null;
  overdueCount: number;
  isCurrentMonth: boolean;
};

/** The month at a glance: in, out, still to pay, and what is left. */
export function MonthSummary({
  summary,
  spentAverage,
  overdueCount,
  isCurrentMonth,
}: MonthSummaryProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const { isNarrowWidth, isWideWidth } = useResponsive();

  const spentDetail =
    spentAverage != null && spentAverage > 0
      ? t('{{percent}}% of the 3-month average', {
          percent: Math.round((summary.spent / spentAverage) * 100),
        })
      : undefined;

  return (
    <View
      style={{
        display: 'grid',
        gridTemplateColumns: isWideWidth ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)',
        gap: isNarrowWidth ? 8 : 12,
      }}
    >
      <Tile label={t('Income')} value={format(summary.income, 'financial')} />
      <Tile
        label={t('Spent')}
        value={format(summary.spent, 'financial')}
        detail={spentDetail}
      />
      <Tile
        label={t('Left to pay')}
        value={format(summary.toPay, 'financial')}
        detail={
          overdueCount > 0
            ? t('{{count}} overdue', { count: overdueCount })
            : undefined
        }
        detailColor={overdueCount > 0 ? theme.errorText : undefined}
      />
      <Tile
        label={isCurrentMonth ? t('Left after bills') : t('Month result')}
        value={format(summary.left, 'financial')}
        valueColor={summary.left < 0 ? theme.errorText : undefined}
        detail={
          isCurrentMonth
            ? summary.leftWithIncome != null
              ? t('{{amount}} with expected income', {
                  amount: format(summary.leftWithIncome, 'financial'),
                })
              : t('Account balances minus bills still due')
            : t('Income minus spending')
        }
        privateDetail={summary.leftWithIncome != null && isCurrentMonth}
      />
    </View>
  );
}

type TileProps = {
  label: string;
  value: string;
  valueColor?: string;
  detail?: string;
  detailColor?: string;
  privateDetail?: boolean;
};

function Tile({
  label,
  value,
  valueColor,
  detail,
  detailColor,
  privateDetail = false,
}: TileProps) {
  const { isNarrowWidth } = useResponsive();
  const detailText: ReactNode = privateDetail ? (
    <PrivacyFilter>{detail}</PrivacyFilter>
  ) : (
    detail
  );
  return (
    <View
      style={{
        padding: isNarrowWidth ? 10 : 14,
        gap: 4,
        minWidth: 0,
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
      }}
    >
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>
      <PrivacyFilter>
        <FinancialText
          style={{
            fontSize: isNarrowWidth ? 18 : 22,
            fontWeight: 600,
            color: valueColor ?? theme.pageText,
            ...styles.lineClamp(1),
          }}
        >
          {value}
        </FinancialText>
      </PrivacyFilter>
      {detail && (
        <Text
          style={{
            ...styles.smallText,
            color: detailColor ?? theme.pageTextSubdued,
          }}
        >
          {detailText}
        </Text>
      )}
    </View>
  );
}
