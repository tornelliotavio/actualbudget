import { useTranslation } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { StatementPreview } from '@actual-app/core/server/credit-cards/statements/import';
import * as monthUtils from '@actual-app/core/shared/months';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

type StatementSummaryProps = { preview: StatementPreview };

/** What the statement says about the bill itself. */
export function StatementSummary({ preview }: StatementSummaryProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const { statement } = preview;
  const date = (value: string) => monthUtils.format(value, dateFormat, locale);

  const figures: Array<{ label: string; value: string; isAmount: boolean }> = [
    { label: t('Due on'), value: date(statement.dueDate), isAmount: false },
    {
      label: t('Closed on'),
      value: date(statement.closingDate),
      isAmount: false,
    },
    {
      label: t('Bill total'),
      value: format(statement.total, 'financial'),
      isAmount: true,
    },
    ...(statement.minimumPayment != null
      ? [
          {
            label: t('Minimum payment'),
            value: format(statement.minimumPayment, 'financial'),
            isAmount: true,
          },
        ]
      : []),
    ...(statement.creditLimit != null
      ? [
          {
            label: t('Limit'),
            value: format(statement.creditLimit, 'financial'),
            isAmount: true,
          },
        ]
      : []),
  ];

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ ...styles.mediumText, fontWeight: 600 }}>
        {statement.cardLast4
          ? t('{{issuer}} statement, card ending in {{last4}}', {
              issuer: preview.issuerName,
              last4: statement.cardLast4,
            })
          : t('{{issuer}} statement', { issuer: preview.issuerName })}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '8px 24px' }}>
        {figures.map(figure => (
          <View key={figure.label}>
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              {figure.label}
            </Text>
            {figure.isAmount ? (
              <PrivacyFilter>
                <FinancialText style={{ fontWeight: 600 }}>
                  {figure.value}
                </FinancialText>
              </PrivacyFilter>
            ) : (
              <Text style={{ fontWeight: 600 }}>{figure.value}</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
