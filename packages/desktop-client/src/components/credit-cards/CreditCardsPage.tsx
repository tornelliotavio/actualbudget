import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import { useQueries, useQuery } from '@tanstack/react-query';

import { Page } from '#components/Page';
import { creditCardQueries } from '#credit-cards';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { CreditCardsGate, Money, Stack, StatusLabel } from './ui';

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

  return (
    <Page header={t('Credit cards')}>
      <Stack>
        <View style={{ flexDirection: 'row' }}>
          <Button
            variant="primary"
            onPress={() => {
              dispatch(pushModal({ modal: { name: 'credit-card-create' } }));
            }}
          >
            <Trans>Add card</Trans>
          </Button>
        </View>
        {cards.data?.length === 0 && (
          <Text>
            <Trans>
              No cards yet. Add one for an account you already track, then
              import its statement or enter purchases by hand.
            </Trans>
          </Text>
        )}
        {(cards.data ?? []).map((card, index) => {
          const projection = projections[index]?.data;
          const statement = projection?.summary.statement;
          const upcoming =
            projection?.installments.filter(
              installment =>
                installment.transactionId == null &&
                installment.status === 'projected',
            ).length ?? 0;
          return (
            <View
              key={card.id}
              style={{
                border: `1px solid ${theme.tableBorder}`,
                borderRadius: 8,
                padding: 16,
                gap: 8,
              }}
            >
              <Link
                to={`/credit-cards/${card.id}`}
                style={{ color: theme.pageTextLink, fontSize: 18 }}
              >
                {card.name}
              </Link>
              <Text style={{ color: theme.pageTextLight }}>
                {card.institution || card.provider}
              </Text>
              <View style={{ flexDirection: 'row', gap: 24, flexWrap: 'wrap' }}>
                <Labeled label={<Trans>Current bill</Trans>}>
                  <Money
                    amount={projection?.summary.currentBillAmount ?? null}
                  />
                </Labeled>
                <Labeled label={<Trans>Due date</Trans>}>
                  {statement ? (
                    <Text>{statement.dueDate}</Text>
                  ) : (
                    <Trans>Not available</Trans>
                  )}
                </Labeled>
                <Labeled label={<Trans>Status</Trans>}>
                  {statement ? (
                    <StatusLabel status={statement.status} />
                  ) : (
                    <Trans>Not available</Trans>
                  )}
                </Labeled>
                <Labeled label={<Trans>Available limit</Trans>}>
                  <Money amount={card.availableLimit} />
                </Labeled>
                <Labeled label={<Trans>Upcoming installments</Trans>}>
                  <Text>{upcoming}</Text>
                </Labeled>
                <Labeled label={<Trans>Last limit update</Trans>}>
                  {card.limitUpdatedAt ? (
                    <Text>{card.limitUpdatedAt}</Text>
                  ) : (
                    <Trans>Not available</Trans>
                  )}
                </Labeled>
              </View>
            </View>
          );
        })}
      </Stack>
    </Page>
  );
}

function Labeled({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 2, minWidth: 120 }}>
      <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>{label}</Text>
      {children}
    </View>
  );
}
