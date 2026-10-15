import { Trans, useTranslation } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { CardBillsResult } from '@actual-app/core/server/credit-cards/bills';
import * as monthUtils from '@actual-app/core/shared/months';
import type { AccountEntity } from '@actual-app/core/types/models';

import { Link } from '#components/common/Link';
import { FinancialText } from '#components/FinancialText';
import { Page } from '#components/Page';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useAccounts } from '#hooks/useAccounts';
import { useAllCardBills } from '#hooks/useCardBills';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import {
  amountDue,
  getBillStatusColors,
  getBillStatusLabel,
} from './billStatus';

const MONTHS_SHOWN = 6;

/**
 * Every credit card's bills side by side for the coming months, with what
 * all cards ask for each month underneath.
 */
export function CardsPage() {
  const { t } = useTranslation();
  const { data: accounts = [] } = useAccounts();
  const cards = accounts.filter(
    account => account.kind === 'credit_card' && !account.closed,
  );
  const { data } = useAllCardBills(cards.map(card => card.id));

  const firstMonth = (data ?? [])
    .map(({ result }) => result.currentMonth)
    .filter((month): month is string => month != null)
    .sort()[0];
  const months = firstMonth
    ? Array.from({ length: MONTHS_SHOWN }, (_, index) =>
        monthUtils.addMonths(firstMonth, index),
      )
    : [];

  return (
    <Page header={t('Credit cards')}>
      {cards.length === 0 ? (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            No credit card accounts yet. Create an account of type credit card,
            or link a card through bank sync.
          </Trans>
        </Text>
      ) : (
        <View style={{ overflowX: 'auto' }}>
          <View style={{ minWidth: 200 + months.length * 130 }}>
            <MonthHeader months={months} />
            {cards.map(card => (
              <CardRow
                key={card.id}
                card={card}
                months={months}
                result={data?.find(row => row.accountId === card.id)?.result}
              />
            ))}
            <TotalRow
              months={months}
              results={(data ?? []).map(row => row.result)}
            />
          </View>
        </View>
      )}
    </Page>
  );
}

function MonthHeader({ months }: { months: string[] }) {
  const locale = useLocale();
  return (
    <View style={{ flexDirection: 'row', ...rowStyle }}>
      <View style={nameCellStyle} />
      {months.map(month => (
        <Text
          key={month}
          style={{
            ...cellStyle,
            ...styles.smallText,
            color: theme.pageTextSubdued,
          }}
        >
          {monthUtils.format(month, 'MMM yyyy', locale)}
        </Text>
      ))}
    </View>
  );
}

type CardRowProps = {
  card: AccountEntity;
  months: string[];
  result: CardBillsResult | undefined;
};

function CardRow({ card, months, result }: CardRowProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const bills = result?.status === 'ok' ? result.bills : [];

  return (
    <View style={{ flexDirection: 'row', ...rowStyle }}>
      <View style={nameCellStyle}>
        <Link variant="internal" to={`/accounts/${card.id}`}>
          {card.name}
        </Link>
        {result?.status === 'needs-schedule' && (
          <Text style={{ ...styles.smallText, color: theme.warningText }}>
            <Trans>Missing closing and due days</Trans>
          </Text>
        )}
        {result?.status === 'ok' && result.limit.available != null && (
          <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
            <PrivacyFilter>
              {t('{{available}} available', {
                available: format(result.limit.available, 'financial'),
              })}
            </PrivacyFilter>
          </Text>
        )}
      </View>
      {months.map(month => {
        const bill = bills.find(row => row.referenceMonth === month);
        return (
          <View key={month} style={cellStyle}>
            {bill && (
              <>
                <PrivacyFilter>
                  <FinancialText>
                    {format(amountDue(bill), 'financial')}
                  </FinancialText>
                </PrivacyFilter>
                <Text
                  style={{
                    ...styles.smallText,
                    alignSelf: 'flex-end',
                    borderRadius: 4,
                    padding: '0 5px',
                    ...getBillStatusColors(bill.status),
                  }}
                >
                  {getBillStatusLabel(bill.status, t)}
                </Text>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

type TotalRowProps = {
  months: string[];
  results: CardBillsResult[];
};

function TotalRow({ months, results }: TotalRowProps) {
  const format = useFormat();
  const bills = results.flatMap(result =>
    result.status === 'ok' ? result.bills : [],
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        ...rowStyle,
        color: theme.pageTextSubdued,
      }}
    >
      <Text style={{ ...nameCellStyle, ...styles.smallText }}>
        <Trans>All cards</Trans>
      </Text>
      {months.map(month => (
        <View key={month} style={cellStyle}>
          <PrivacyFilter>
            <FinancialText>
              {format(
                bills
                  .filter(bill => bill.referenceMonth === month)
                  .reduce((sum, bill) => sum + amountDue(bill), 0),
                'financial',
              )}
            </FinancialText>
          </PrivacyFilter>
        </View>
      ))}
    </View>
  );
}

const rowStyle = {
  padding: '8px 0',
  borderBottom: `1px solid ${theme.tableBorder}`,
};

const nameCellStyle = {
  width: 200,
  flexShrink: 0,
  gap: 2,
};

const cellStyle = {
  width: 130,
  flexShrink: 0,
  alignItems: 'flex-end' as const,
  textAlign: 'right' as const,
  gap: 2,
};
