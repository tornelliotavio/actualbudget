import { useTranslation } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { StatementPreviewEntry } from '@actual-app/core/server/credit-cards/statements/import';
import * as monthUtils from '@actual-app/core/shared/months';
import type { TFunction } from 'i18next';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

type StatementEntryListProps = { entries: StatementPreviewEntry[] };

function statusLabel(
  entry: StatementPreviewEntry,
  t: TFunction,
  shortDate: (date: string) => string,
) {
  switch (entry.status) {
    case 'new':
      return t('Will be added');
    case 'replaces':
      return t('Replaces the entry of {{date}}', {
        date: shortDate(entry.replaces?.date ?? entry.postingDate),
      });
    case 'imported':
      return t('Already imported');
    case 'on-card':
      return t('Payment already on the card');
    default:
      return entry.status satisfies never;
  }
}

function statusColors(entry: StatementPreviewEntry) {
  switch (entry.status) {
    case 'new':
      return {
        color: theme.noticeText,
        backgroundColor: theme.noticeBackgroundLight,
      };
    case 'replaces':
      return {
        color: theme.warningTextDark,
        backgroundColor: theme.warningBackground,
      };
    case 'imported':
    case 'on-card':
      return {
        color: theme.pageTextSubdued,
        backgroundColor: theme.tableRowBackgroundHover,
      };
    default:
      return entry.status satisfies never;
  }
}

/** Every line of the statement and what importing does with it. */
export function StatementEntryList({ entries }: StatementEntryListProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const shortDate = (date: string) =>
    monthUtils.format(date, monthUtils.getDayMonthFormat(dateFormat), locale);

  return (
    <View
      style={{
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        maxHeight: 360,
        overflowY: 'auto',
      }}
    >
      {entries.map((entry, index) => (
        <View
          key={`${entry.postingDate}:${entry.amount}:${index}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            borderTop:
              index === 0 ? undefined : `1px solid ${theme.tableBorder}`,
            backgroundColor: theme.tableBackground,
          }}
        >
          <Text
            style={{
              ...styles.tnum,
              width: 46,
              flexShrink: 0,
              color: theme.pageTextSubdued,
            }}
          >
            {shortDate(entry.postingDate)}
          </Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={entry.description}
            >
              {entry.merchant ?? entry.description}
            </Text>
            <Text
              style={{
                ...styles.smallText,
                color: theme.pageTextSubdued,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {[
                entry.installment
                  ? t('Installment {{number}} of {{count}}', entry.installment)
                  : null,
                entry.merchant ? entry.description : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Text
            style={{
              ...styles.smallText,
              flexShrink: 0,
              borderRadius: 4,
              padding: '2px 6px',
              ...statusColors(entry),
            }}
          >
            {statusLabel(entry, t, shortDate)}
          </Text>
          <PrivacyFilter>
            <FinancialText
              style={{
                width: 90,
                textAlign: 'right',
                flexShrink: 0,
                color: entry.amount > 0 ? theme.noticeText : theme.pageText,
              }}
            >
              {format(entry.amount, 'financial')}
            </FinancialText>
          </PrivacyFilter>
        </View>
      ))}
    </View>
  );
}
