import { useTranslation } from 'react-i18next';

import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CardBill } from '@actual-app/core/server/credit-cards/bills';

import { BillLegendItem } from './BillLegendItem';

type Segment = {
  key: string;
  label: string;
  amount: number;
  color: string;
  /** Shown in the legend only; the bar has no room for negative parts. */
  legendOnly?: boolean;
};

/**
 * What a bill is made of while it is open, and how much of it was paid once
 * it closed: a proportional bar with a legend of the amounts.
 */
export function BillBreakdown({ bill }: { bill: CardBill }) {
  const { t } = useTranslation();
  const isSettled = bill.status !== 'open' && bill.status !== 'upcoming';

  const segments: Segment[] = isSettled
    ? [
        {
          key: 'paid',
          label: t('Already paid'),
          amount: bill.paid,
          color: theme.reportsGreen,
        },
        {
          key: 'remaining',
          label: t('Left to pay'),
          amount: bill.remaining,
          color:
            bill.status === 'overdue' ? theme.reportsRed : theme.tableBorder,
        },
      ]
    : [
        {
          key: 'previous',
          label: t('From the previous bill'),
          amount: bill.previousBalance,
          color: theme.reportsLabel,
          legendOnly: bill.previousBalance < 0,
        },
        {
          key: 'posted',
          label: t('On the card'),
          amount: bill.total - bill.projectedCharges - bill.previousBalance,
          color: theme.reportsBlue,
        },
        {
          key: 'projected',
          label: t('Projected installments'),
          amount: bill.projectedCharges,
          color: theme.reportsGray,
        },
      ];
  const shown = segments.filter(segment => segment.amount !== 0);
  const bar = shown.filter(
    segment => !segment.legendOnly && segment.amount > 0,
  );
  const barTotal = bar.reduce((sum, segment) => sum + segment.amount, 0);

  return (
    <View style={{ gap: 8 }}>
      {barTotal > 0 && (isSettled || bar.length > 1) && (
        <View
          style={{
            flexDirection: 'row',
            height: 8,
            borderRadius: 4,
            overflow: 'hidden',
            gap: 2,
            backgroundColor: theme.tableBorder,
          }}
        >
          {bar.map(segment => (
            <View
              key={segment.key}
              style={{
                flexGrow: segment.amount / barTotal,
                flexBasis: 0,
                backgroundColor: segment.color,
              }}
            />
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '6px 18px' }}>
        {shown.map(segment => (
          <BillLegendItem
            key={segment.key}
            label={segment.label}
            amount={segment.amount}
            color={segment.color}
          />
        ))}
        {isSettled && bill.minimumPayment != null && bill.remaining > 0 && (
          <BillLegendItem
            label={t('Minimum payment')}
            amount={bill.minimumPayment}
          />
        )}
        {bill.divergence != null && bill.divergence !== 0 && (
          <BillLegendItem
            label={t('Difference from the bank')}
            amount={bill.divergence}
            textColor={theme.warningText}
          />
        )}
      </View>
    </View>
  );
}
