import { Trans } from 'react-i18next';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import type { CardProjection } from '#credit-cards';

import { BillsChart } from './BillsChart';
import {
  MeterBar,
  Money,
  Panel,
  SourceBadge,
  Stat,
  StatusBadge,
  usageColor,
  useCardDates,
} from './ui';

export function CardOverview({ projection }: { projection: CardProjection }) {
  const dates = useCardDates();
  const { card, summary, bills } = projection;
  const statement = summary.statement;
  const openBill = summary.openBill;
  const used =
    card.creditLimit != null && card.availableLimit != null
      ? card.creditLimit - card.availableLimit
      : null;

  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
        <Panel
          style={{ flex: '2 1 380px' }}
          title={
            statement ? (
              <Trans>
                Current bill ·{' '}
                {{ month: dates.month(statement.referenceMonth) }}
              </Trans>
            ) : (
              <Trans>Current bill</Trans>
            )
          }
          actions={statement && <StatusBadge status={statement.status} />}
        >
          {statement ? (
            <View style={{ gap: 16 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                  gap: 16,
                }}
              >
                <View style={{ gap: 6 }}>
                  <Money
                    amount={statement.amountOwed}
                    style={{
                      fontSize: 34,
                      fontWeight: 600,
                      lineHeight: 1.1,
                      color: theme.pageText,
                    }}
                  />
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Text
                      style={{
                        ...styles.smallText,
                        color: theme.pageTextLight,
                      }}
                    >
                      <Trans>
                        Closed {{ closing: dates.day(statement.closingDate) }} ·
                        due {{ due: dates.day(statement.dueDate) }}
                      </Trans>
                    </Text>
                    <SourceBadge
                      source={
                        statement.confirmedTotal != null ? 'bank' : 'computed'
                      }
                    />
                  </View>
                </View>
                <Stat
                  label={<Trans>Left to pay</Trans>}
                  amount={Math.max(statement.remaining, 0)}
                  style={{ alignItems: 'flex-end' }}
                />
              </View>
              <View style={{ gap: 6 }}>
                <MeterBar
                  value={statement.amountPaid}
                  total={statement.amountOwed}
                  color={theme.reportsGreen}
                />
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    ...styles.verySmallText,
                    color: theme.pageTextLight,
                  }}
                >
                  <Text>
                    <Trans>Paid</Trans> <Money amount={statement.amountPaid} />
                  </Text>
                  {statement.minimumPayment != null && (
                    <Text>
                      <Trans>Minimum</Trans>{' '}
                      <Money amount={statement.minimumPayment} />
                    </Text>
                  )}
                </View>
              </View>
            </View>
          ) : (
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>
                No closed bill yet. Charges show up here once the first cycle
                closes.
              </Trans>
            </Text>
          )}
        </Panel>

        <Panel style={{ flex: '1 1 300px' }} title={<Trans>Limit</Trans>}>
          {card.creditLimit != null ? (
            <View style={{ gap: 14 }}>
              {used != null && (
                <MeterBar
                  value={used}
                  total={card.creditLimit}
                  color={usageColor(used, card.creditLimit)}
                  height={10}
                />
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
                <Stat label={<Trans>Used</Trans>} amount={used} />
                <Stat
                  label={<Trans>Available</Trans>}
                  amount={card.availableLimit}
                />
                <Stat label={<Trans>Total</Trans>} amount={card.creditLimit} />
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  ...styles.verySmallText,
                  color: theme.pageTextLight,
                }}
              >
                {card.creditLimitSource && (
                  <SourceBadge source={card.creditLimitSource} />
                )}
                {card.limitUpdatedAt && (
                  <Text>
                    <Trans>
                      Updated {{ when: dates.relative(card.limitUpdatedAt) }}
                    </Trans>
                  </Text>
                )}
              </View>
            </View>
          ) : (
            <Text style={{ color: theme.pageTextSubdued }}>
              <Trans>
                No limit set. Add one in Settings, or sync a linked card from
                the bank.
              </Trans>
            </Text>
          )}
        </Panel>
      </View>

      <Panel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 32 }}>
          <Stat
            label={<Trans>Next bill so far</Trans>}
            amount={openBill ? openBill.amountOwed : null}
            caption={
              !openBill ? undefined : openBill.projectedTotal >
                openBill.computedTotal ? (
                <Trans>
                  Closes {{ date: dates.day(openBill.closingDate) }} · includes
                  installments not posted yet
                </Trans>
              ) : (
                <Trans>
                  Closes {{ date: dates.day(openBill.closingDate) }}
                </Trans>
              )
            }
          />
          <Stat
            label={<Trans>Future installments</Trans>}
            amount={summary.futureCommitments}
            caption={<Trans>Bills that close after this one</Trans>}
          />
          <Stat
            label={<Trans>Total commitment</Trans>}
            amount={summary.totalCommitment}
            caption={<Trans>Bills plus future installments</Trans>}
          />
          <Stat
            label={<Trans>Account balance in Actual</Trans>}
            amount={summary.accountBalance}
            caption={<Trans>Everything posted to the account</Trans>}
          />
        </View>
      </Panel>

      <Panel title={<Trans>Bill history</Trans>}>
        <BillsChart cardId={card.id} bills={bills} />
      </Panel>
    </View>
  );
}
