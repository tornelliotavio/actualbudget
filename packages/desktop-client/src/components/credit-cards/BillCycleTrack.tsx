import { useTranslation } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CardBill } from '@actual-app/core/server/credit-cards/bills';
import * as monthUtils from '@actual-app/core/shared/months';
import type { TFunction } from 'i18next';

import { useDateFormat } from '#hooks/useDateFormat';
import { useLocale } from '#hooks/useLocale';

import { getBillCycle } from './billTrend';
import type { BillCycle } from './billTrend';

type BillCycleTrackProps = {
  bill: CardBill;
  today: string;
};

/**
 * The bill's cycle as a track from its first day to the due date, with the
 * closing date and today marked, and how long until the next step.
 */
export function BillCycleTrack({ bill, today }: BillCycleTrackProps) {
  const { t } = useTranslation();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();
  const shortDate = (date: string) =>
    monthUtils.format(date, monthUtils.getDayMonthFormat(dateFormat), locale);

  const cycle = getBillCycle(bill, today);
  const isPaid = bill.status === 'paid';
  const fill = isPaid ? 1 : cycle.todayShare;
  const fillColor = isPaid
    ? theme.reportsGray
    : bill.status === 'overdue'
      ? theme.reportsRed
      : theme.reportsBlue;
  const showToday = !isPaid && cycle.todayShare > 0 && cycle.todayShare < 1;
  const caption = getCycleCaption(bill, cycle, t);
  const isClosed = bill.status !== 'open' && bill.status !== 'upcoming';

  return (
    <View style={{ gap: 4 }}>
      <View style={{ position: 'relative', height: 16 }}>
        <Text
          style={{
            ...styles.smallText,
            color: theme.pageTextSubdued,
            position: 'absolute',
            bottom: 0,
            ...(cycle.closingShare < 0.3
              ? { left: `${cycle.closingShare * 100}%` }
              : { right: `${(1 - cycle.closingShare) * 100}%` }),
            whiteSpace: 'nowrap',
          }}
        >
          {isClosed
            ? t('Closed {{date}}', { date: shortDate(bill.closingDate) })
            : t('Closes {{date}}', { date: shortDate(bill.closingDate) })}
        </Text>
      </View>
      <View
        style={{ position: 'relative', height: 12, justifyContent: 'center' }}
      >
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.tableBorder,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${fill * 100}%`,
              height: '100%',
              backgroundColor: fillColor,
            }}
          />
        </View>
        <View
          style={{
            position: 'absolute',
            left: `calc(${cycle.closingShare * 100}% - 1px)`,
            top: 0,
            width: 2,
            height: 12,
            borderRadius: 1,
            backgroundColor: theme.pageTextSubdued,
          }}
        />
        {showToday && (
          <View
            aria-hidden
            style={{
              position: 'absolute',
              left: `calc(${cycle.todayShare * 100}% - 6px)`,
              top: 0,
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: fillColor,
              border: `2px solid ${theme.tableBackground}`,
            }}
          />
        )}
      </View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
          {bill.status === 'upcoming'
            ? t('Opens {{date}}', { date: shortDate(bill.startDate) })
            : t('Opened {{date}}', { date: shortDate(bill.startDate) })}
        </Text>
        <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
          {t('Due {{date}}', { date: shortDate(bill.effectiveDueDate) })}
        </Text>
      </View>
      {caption && (
        <Text
          style={{
            ...styles.smallText,
            fontWeight: 600,
            color: bill.status === 'overdue' ? theme.errorText : theme.pageText,
          }}
        >
          {caption}
        </Text>
      )}
    </View>
  );
}

function getCycleCaption(bill: CardBill, cycle: BillCycle, t: TFunction) {
  switch (bill.status) {
    case 'paid':
    case 'upcoming':
      return null;
    case 'open':
      if (cycle.daysToClose <= 0) {
        return t('Closes today');
      }
      if (cycle.daysToClose === 1) {
        return t('Closes tomorrow');
      }
      return t('Closes in {{count}} days', { count: cycle.daysToClose });
    case 'overdue':
      if (cycle.daysToDue >= -1) {
        return t('1 day overdue');
      }
      return t('{{count}} days overdue', { count: -cycle.daysToDue });
    case 'closed':
    case 'partially_paid':
      if (cycle.daysToDue <= 0) {
        return t('Due today');
      }
      if (cycle.daysToDue === 1) {
        return t('Due tomorrow');
      }
      return t('Due in {{count}} days', { count: cycle.daysToDue });
    default:
      return bill.status satisfies never;
  }
}
