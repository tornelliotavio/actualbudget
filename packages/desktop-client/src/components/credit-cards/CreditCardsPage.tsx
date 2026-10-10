import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgAdd, SvgCreditCard } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import { useQueries, useQuery } from '@tanstack/react-query';

import { Page } from '#components/Page';
import { creditCardQueries } from '#credit-cards';
import type { CardProjection, CreditCard } from '#credit-cards';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import {
  CreditCardsGate,
  EmptyState,
  MeterBar,
  Money,
  Panel,
  Stack,
  Stat,
  StatusBadge,
  usageColor,
  useCardDates,
} from './ui';

export function CreditCardsPage() {
  return (
    <CreditCardsGate>
      <CardList />
    </CreditCardsGate>
  );
}

function CardList() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const today = currentDay();
  const cards = useQuery(creditCardQueries.list());
  const projections = useQueries({
    queries: (cards.data ?? []).map(card =>
      creditCardQueries.projection(card.id, today),
    ),
  });
  const loaded = projections
    .map(projection => projection.data)
    .filter((data): data is CardProjection => data != null);

  const addCard = () => {
    dispatch(pushModal({ modal: { name: 'credit-card-create' } }));
  };

  return (
    <Page header={t('Credit cards')}>
      <Stack>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
            <Trans>
              Bills, installments and limits for the cards you already track.
            </Trans>
          </Text>
          <Button variant="primary" onPress={addCard}>
            <SvgAdd style={{ width: 10, height: 10, marginRight: 6 }} />
            <Trans>Add card</Trans>
          </Button>
        </View>

        {cards.data?.length === 0 && (
          <EmptyState
            title={<Trans>No cards yet</Trans>}
            description={
              <Trans>
                Add a card for an account you already track. Synced accounts
                fill in the billing cycle and limit from the bank.
              </Trans>
            }
            action={
              <Button variant="primary" onPress={addCard}>
                <Trans>Add card</Trans>
              </Button>
            }
          />
        )}

        {loaded.length > 0 && <Totals projections={loaded} />}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
          {(cards.data ?? []).map((card, index) => (
            <CardTile
              key={card.id}
              card={card}
              projection={projections[index]?.data}
            />
          ))}
        </View>
      </Stack>
    </Page>
  );
}

function Totals({ projections }: { projections: CardProjection[] }) {
  const due = projections.reduce(
    (sum, projection) => sum + projection.summary.amountDue,
    0,
  );
  const upcoming = projections.reduce(
    (sum, projection) => sum + (projection.summary.openBill?.amountOwed ?? 0),
    0,
  );
  const available = projections.reduce(
    (sum, projection) => sum + (projection.card.availableLimit ?? 0),
    0,
  );
  const hasLimits = projections.some(
    projection => projection.card.availableLimit != null,
  );
  return (
    <Panel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 32 }}>
        <Stat
          label={<Trans>Left to pay on closed bills</Trans>}
          amount={due}
          size="large"
        />
        <Stat
          label={<Trans>Next bills so far</Trans>}
          amount={upcoming}
          size="large"
        />
        {hasLimits && (
          <Stat
            label={<Trans>Available limit</Trans>}
            amount={available}
            size="large"
          />
        )}
      </View>
    </Panel>
  );
}

function CardTile({
  card,
  projection,
}: {
  card: CreditCard;
  projection: CardProjection | undefined;
}) {
  const navigate = useNavigate();
  const dates = useCardDates();
  const statement = projection?.summary.statement ?? null;
  const openBill = projection?.summary.openBill ?? null;
  const upcoming =
    projection?.installments.filter(
      installment =>
        installment.transactionId == null && installment.status === 'projected',
    ).length ?? 0;
  const used =
    card.creditLimit != null && card.availableLimit != null
      ? card.creditLimit - card.availableLimit
      : null;

  return (
    <Button
      variant="bare"
      onPress={() => void navigate(`/credit-cards/${card.id}`)}
      style={{
        flex: '1 1 340px',
        maxWidth: 520,
        padding: 0,
        textAlign: 'left',
        borderRadius: 6,
        alignItems: 'stretch',
      }}
    >
      <View
        style={{
          width: '100%',
          backgroundColor: theme.tableBackground,
          border: `1px solid ${theme.tableBorder}`,
          borderRadius: 6,
          transition: 'border-color .25s',
          ':hover': { borderColor: theme.tableBorderHover },
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderBottom: `1px solid ${theme.tableBorder}`,
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              backgroundColor: theme.tableRowHeaderBackground,
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <SvgCreditCard
              style={{ width: 18, height: 18, color: theme.pageTextLight }}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                ...styles.mediumText,
                ...styles.ellipsisText,
                color: theme.pageText,
              }}
            >
              {card.name}
            </Text>
            <Text
              style={{ ...styles.verySmallText, color: theme.pageTextLight }}
            >
              {card.institution && `${card.institution} · `}
              <Trans>
                Closes on day {{ closingDay: card.closingDay }}, due on day{' '}
                {{ dueDay: card.dueDay }}
              </Trans>
            </Text>
          </View>
          {statement && <StatusBadge status={statement.status} />}
        </View>

        <View style={{ padding: 16, gap: 16 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Stat
              label={<Trans>Current bill</Trans>}
              amount={projection ? projection.summary.currentBillAmount : null}
              size="large"
              caption={
                statement ? (
                  <Trans>Due {{ date: dates.day(statement.dueDate) }}</Trans>
                ) : undefined
              }
            />
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text
                style={{ ...styles.smallText, color: theme.pageTextSubdued }}
              >
                <Trans>Left to pay</Trans>
              </Text>
              <Money
                amount={projection ? projection.summary.amountDue : null}
                style={{ fontSize: 16, fontWeight: 500 }}
              />
            </View>
          </View>

          {used != null && card.creditLimit != null && (
            <View style={{ gap: 6 }}>
              <MeterBar
                value={used}
                total={card.creditLimit}
                color={usageColor(used, card.creditLimit)}
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
                  <Trans>Used</Trans> <Money amount={used} />
                </Text>
                <Text>
                  <Trans>Available</Trans>{' '}
                  <Money amount={card.availableLimit} />
                </Text>
              </View>
            </View>
          )}
        </View>

        <View
          style={{
            flexDirection: 'row',
            gap: 20,
            padding: '10px 16px',
            borderTop: `1px solid ${theme.tableBorder}`,
            backgroundColor: theme.tableRowHeaderBackground,
            ...styles.verySmallText,
            color: theme.pageTextLight,
            flexWrap: 'wrap',
          }}
        >
          <Text>
            <Trans>Next bill</Trans>{' '}
            <Money amount={openBill ? openBill.amountOwed : null} />
          </Text>
          <Text>
            <Trans count={upcoming}>
              {{ count: upcoming }} upcoming installments
            </Trans>
          </Text>
          {card.limitUpdatedAt && (
            <Text>
              <Trans>
                Limit updated {{ when: dates.relative(card.limitUpdatedAt) }}
              </Trans>
            </Text>
          )}
        </View>
      </View>
    </Button>
  );
}
