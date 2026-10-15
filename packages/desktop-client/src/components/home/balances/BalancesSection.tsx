import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { Link } from '#components/common/Link';
import { FinancialText } from '#components/FinancialText';
import { HomeSection } from '#components/home/HomeSection';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

import type { HomeAccountBalance } from './useHomeBalances';

type CardDue = {
  accountId: string;
  /** What the card's current bill still asks for. */
  amountDue: number | null;
  available: number | null;
};

type BalancesSectionProps = {
  cash: HomeAccountBalance[];
  cards: HomeAccountBalance[];
  offBudget: HomeAccountBalance[];
  cashTotal: number;
  cardDues: CardDue[];
};

/** Account balances: cash first, then cards with their bill and limit. */
export function BalancesSection({
  cash,
  cards,
  offBudget,
  cashTotal,
  cardDues,
}: BalancesSectionProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const [showOffBudget, setShowOffBudget] = useState(false);

  return (
    <HomeSection
      id="balances"
      title={t('Balances')}
      action={
        <Link variant="internal" to="/accounts" style={styles.smallText}>
          <Trans>All accounts</Trans>
        </Link>
      }
    >
      <Group title={t('Accounts')} total={cashTotal}>
        {cash.map(row => (
          <AccountRow key={row.account.id} row={row} />
        ))}
      </Group>
      {cards.length > 0 && (
        <Group title={t('Credit cards')}>
          {cards.map(row => {
            const due = cardDues.find(
              card => card.accountId === row.account.id,
            );
            return (
              <AccountRow
                key={row.account.id}
                row={row}
                detail={[
                  due?.amountDue != null && due.amountDue > 0
                    ? t('Bill {{amount}}', {
                        amount: format(due.amountDue, 'financial'),
                      })
                    : null,
                  due?.available != null
                    ? t('{{available}} available', {
                        available: format(due.available, 'financial'),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            );
          })}
        </Group>
      )}
      {offBudget.length > 0 && (
        <View>
          <Button
            variant="bare"
            aria-expanded={showOffBudget}
            onPress={() => setShowOffBudget(!showOffBudget)}
            style={{
              justifyContent: 'flex-start',
              padding: '4px 0',
              color: theme.pageTextSubdued,
              ...styles.smallText,
            }}
          >
            {showOffBudget
              ? t('Hide off budget ({{count}})', { count: offBudget.length })
              : t('Show off budget ({{count}})', { count: offBudget.length })}
          </Button>
          {showOffBudget &&
            offBudget.map(row => <AccountRow key={row.account.id} row={row} />)}
        </View>
      )}
    </HomeSection>
  );
}

function Group({
  title,
  total,
  children,
}: {
  title: string;
  total?: number;
  children: ReactNode;
}) {
  const format = useFormat();
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingBottom: 4,
          ...styles.smallText,
          color: theme.pageTextSubdued,
        }}
      >
        <Text>{title}</Text>
        {total != null && (
          <PrivacyFilter>
            <FinancialText>{format(total, 'financial')}</FinancialText>
          </PrivacyFilter>
        )}
      </View>
      {children}
    </View>
  );
}

function AccountRow({
  row,
  detail,
}: {
  row: HomeAccountBalance;
  detail?: string;
}) {
  const format = useFormat();
  const { isNarrowWidth } = useResponsive();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: isNarrowWidth ? 44 : 34,
        borderTop: `1px solid ${theme.tableBorder}`,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Link
          variant="internal"
          to={`/accounts/${row.account.id}`}
          style={{ ...styles.lineClamp(1), color: theme.pageText }}
        >
          {row.account.name}
        </Link>
        {detail && (
          <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
            <PrivacyFilter>{detail}</PrivacyFilter>
          </Text>
        )}
      </View>
      <PrivacyFilter>
        <FinancialText
          style={{
            fontWeight: 500,
            color:
              row.balance != null && row.balance < 0
                ? theme.errorText
                : theme.pageText,
          }}
        >
          {row.balance == null ? '...' : format(row.balance, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}
