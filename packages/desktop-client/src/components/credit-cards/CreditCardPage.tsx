import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { Button } from '@actual-app/components/button';
import { SvgRefresh } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Page } from '#components/Page';
import { creditCardQueries, useReconcileCard } from '#credit-cards';
import type { CardProjection } from '#credit-cards';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { AssignPanel } from './AssignPanel';
import { BillsTable } from './BillsTable';
import { CardOverview } from './CardOverview';
import { CardSettings } from './CardSettings';
import { InstallmentsSection } from './InstallmentsSection';
import { PaymentsSection } from './PaymentsSection';
import { SyncBankPanel } from './SyncBankPanel';
import {
  BackLink,
  CreditCardsGate,
  Failure,
  Notice,
  SectionTabs,
  Stack,
} from './ui';

type Section = 'overview' | 'bills' | 'installments' | 'payments' | 'settings';

export function CreditCardPage() {
  return (
    <CreditCardsGate>
      <CardDetail />
    </CreditCardsGate>
  );
}

function CardDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const today = currentDay();
  const projection = useQuery(creditCardQueries.projection(id, today));

  if (projection.isError) {
    return (
      <Page header={t('Credit card')}>
        <Stack>
          <BackLink to="/credit-cards">
            <Trans>Credit cards</Trans>
          </BackLink>
          <Failure message={projection.error.message} />
        </Stack>
      </Page>
    );
  }
  if (!projection.data) {
    return (
      <Page header={t('Credit card')}>
        <Stack>
          <Text style={{ color: theme.pageTextSubdued }}>
            <Trans>Loading…</Trans>
          </Text>
        </Stack>
      </Page>
    );
  }
  return <CardContent projection={projection.data} />;
}

function CardContent({ projection }: { projection: CardProjection }) {
  const { card, summary, readOnly } = projection;
  const [section, setSection] = useState<Section>('overview');
  const [assigning, setAssigning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const unlinkedCount = projection.unlinkedPayments.length;

  return (
    <Page header={card.name}>
      <Stack>
        <CardToolbar
          projection={projection}
          onImported={() => {
            setSection('overview');
            setAssigning(true);
          }}
          onAssign={() => {
            setSection('overview');
            setAssigning(true);
          }}
          onSync={() => setSyncing(true)}
        />

        {syncing && (
          <SyncBankPanel
            cardId={card.id}
            readOnly={readOnly}
            onClose={() => setSyncing(false)}
          />
        )}

        {readOnly && (
          <Notice tone="warning">
            <Trans>
              This budget uses a newer credit card schema. You can look, but not
              change anything, until the app is updated.
            </Trans>
          </Notice>
        )}

        <SectionTabs<Section>
          sections={[
            ['overview', <Trans key="overview">Overview</Trans>],
            ['bills', <Trans key="bills">Bills</Trans>],
            ['installments', <Trans key="installments">Installments</Trans>],
            [
              'payments',
              unlinkedCount > 0 ? (
                <Trans key="payments" count={unlinkedCount}>
                  Payments ({{ count: unlinkedCount }})
                </Trans>
              ) : (
                <Trans key="payments">Payments</Trans>
              ),
            ],
            ['settings', <Trans key="settings">Settings</Trans>],
          ]}
          current={section}
          onSelect={setSection}
        />

        {section === 'overview' && (
          <>
            {assigning && (
              <AssignPanel
                cardId={card.id}
                months={projection.bills.map(bill => bill.referenceMonth)}
                defaultMonth={summary.statement?.referenceMonth ?? null}
                readOnly={readOnly}
                onClose={() => setAssigning(false)}
              />
            )}
            <CardOverview projection={projection} />
          </>
        )}
        {section === 'bills' && (
          <BillsTable
            cardId={card.id}
            bills={projection.bills}
            readOnly={readOnly}
          />
        )}
        {section === 'installments' && (
          <InstallmentsSection
            cardId={card.id}
            purchases={projection.purchases}
            installments={projection.installments}
            readOnly={readOnly}
          />
        )}
        {section === 'payments' && (
          <PaymentsSection
            cardId={card.id}
            bills={projection.bills}
            payments={projection.payments}
            unlinked={projection.unlinkedPayments}
            readOnly={readOnly}
          />
        )}
        {section === 'settings' && (
          <CardSettings key={card.updatedAt} card={card} readOnly={readOnly} />
        )}
      </Stack>
    </Page>
  );
}

function CardToolbar({
  projection,
  onImported,
  onAssign,
  onSync,
}: {
  projection: CardProjection;
  onImported: () => void;
  onAssign: () => void;
  onSync: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const reconcile = useReconcileCard();
  const { card, readOnly } = projection;

  const importStatement = async () => {
    const chosen = await window.Actual.openFileDialog({
      filters: [
        {
          name: t('Financial files'),
          extensions: ['qif', 'ofx', 'qfx', 'csv', 'tsv', 'xml'],
        },
      ],
    });
    if (!chosen || chosen.length === 0) {
      return;
    }
    dispatch(
      pushModal({
        modal: {
          name: 'import-transactions',
          options: {
            accountId: card.accountId,
            filename: chosen[0],
            onImported: didChange => {
              if (didChange) {
                void queryClient.invalidateQueries({
                  queryKey: creditCardQueries.all,
                });
                onImported();
              }
            },
          },
        },
      }),
    );
  };

  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <View style={{ gap: 4 }}>
          <BackLink to="/credit-cards">
            <Trans>Credit cards</Trans>
          </BackLink>
          <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
            {card.institution && `${card.institution} · `}
            <Trans>
              Closes on day {{ closingDay: card.closingDay }}, due on day{' '}
              {{ dueDay: card.dueDay }}
            </Trans>
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {card.provider === 'pluggyai' && (
            <Button isDisabled={readOnly} onPress={onSync}>
              <SvgRefresh style={{ width: 11, height: 11, marginRight: 6 }} />
              <Trans>Sync from bank</Trans>
            </Button>
          )}
          <Button
            isDisabled={readOnly || reconcile.isPending}
            onPress={() => reconcile.mutate(card.id)}
          >
            <Trans>Reconcile</Trans>
          </Button>
          <Button isDisabled={readOnly} onPress={onAssign}>
            <Trans>Assign transactions</Trans>
          </Button>
          <Button
            variant="primary"
            isDisabled={readOnly}
            onPress={() => void importStatement()}
          >
            <Trans>Import statement</Trans>
          </Button>
        </View>
      </View>

      {reconcile.data && (
        <Notice tone={reconcile.data.reviews > 0 ? 'warning' : 'info'}>
          <Trans>
            Grouped {{ purchases: reconcile.data.purchases }} purchases, linked{' '}
            {{ installments: reconcile.data.installmentsLinked }} installments
            and {{ payments: reconcile.data.paymentsLinked }} payments.
          </Trans>{' '}
          {reconcile.data.reviews > 0 && (
            <Trans>
              Some matches were ambiguous and are waiting in Payments.
            </Trans>
          )}
        </Notice>
      )}
      {reconcile.error && <Failure message={reconcile.error.message} />}
    </View>
  );
}
