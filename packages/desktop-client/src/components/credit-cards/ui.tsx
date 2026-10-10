import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Paragraph } from '@actual-app/components/paragraph';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { listen } from '@actual-app/core/platform/client/connection';
import { useQueryClient } from '@tanstack/react-query';

import { FinancialText } from '#components/FinancialText';
import { Page } from '#components/Page';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { creditCardQueries } from '#credit-cards';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useFormat } from '#hooks/useFormat';

export function useCreditCardSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = listen('sync-event', event => {
      if (event.type !== 'applied' || !('tables' in event)) {
        return;
      }
      const tables = event.tables;
      const touched = tables.some(
        table =>
          table.startsWith('credit_card') ||
          table === 'transactions' ||
          table === 'preferences',
      );
      if (touched) {
        void queryClient.invalidateQueries({
          queryKey: creditCardQueries.all,
        });
      }
    });
    return () => {
      unlisten();
    };
  }, [queryClient]);
}

export function CreditCardsGate({ children }: { children: ReactNode }) {
  const enabled = useFeatureFlag('creditCards');
  const { t } = useTranslation();
  useCreditCardSync();
  if (!enabled) {
    return (
      <Page header={t('Credit cards')}>
        <Paragraph>
          <Trans>
            Turn on credit cards in Settings, under Experimental features.
          </Trans>
        </Paragraph>
      </Page>
    );
  }
  return children;
}

export function Money({ amount }: { amount: number | null }) {
  const format = useFormat();
  if (amount == null) {
    return (
      <Text>
        <Trans>Not available</Trans>
      </Text>
    );
  }
  return (
    <PrivacyFilter>
      <FinancialText>{format(amount, 'financial')}</FinancialText>
    </PrivacyFilter>
  );
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
      <SourceLabel source={source} />
    </Text>
  );
}

function SourceLabel({ source }: { source: string }) {
  if (source === 'bank') {
    return <Trans>Bank-confirmed</Trans>;
  }
  if (source === 'projected') {
    return <Trans>Projected</Trans>;
  }
  if (source === 'manual') {
    return <Trans>Entered manually</Trans>;
  }
  if (source === 'imported') {
    return <Trans>Imported</Trans>;
  }
  return <Trans>Pending reconciliation</Trans>;
}

export function StatusLabel({ status }: { status: string }) {
  if (status === 'open') {
    return <Trans>Open</Trans>;
  }
  if (status === 'closed') {
    return <Trans>Closed</Trans>;
  }
  if (status === 'partially_paid') {
    return <Trans>Partially paid</Trans>;
  }
  if (status === 'paid') {
    return <Trans>Paid</Trans>;
  }
  if (status === 'overdue') {
    return <Trans>Overdue</Trans>;
  }
  if (status === 'cancelled') {
    return <Trans>Cancelled</Trans>;
  }
  return <Trans>Pending reconciliation</Trans>;
}

export function Failure({ message }: { message: string }) {
  return (
    <Text style={{ color: theme.errorText }}>
      <FailureText message={message} />
    </Text>
  );
}

function FailureText({ message }: { message: string }) {
  if (message === 'upgrade-required') {
    return (
      <Trans>
        This budget uses a newer credit card schema. Update the app before
        changing cards.
      </Trans>
    );
  }
  if (message === 'not-found') {
    return <Trans>That card could not be found.</Trans>;
  }
  if (message === 'invalid-cycle') {
    return <Trans>Closing day and due day must be between 1 and 31.</Trans>;
  }
  if (message === 'invalid-amount' || message === 'invalid-limit') {
    return <Trans>Enter a valid amount.</Trans>;
  }
  if (message === 'invalid-installments') {
    return <Trans>Use between 1 and 48 installments.</Trans>;
  }
  if (message === 'not-a-payment') {
    return <Trans>Choose a payment that arrived on the card.</Trans>;
  }
  if (message === 'unknown-account' || message === 'account-required') {
    return <Trans>Choose an account.</Trans>;
  }
  return <Trans>Something went wrong.</Trans>;
}

export function Stack({ children }: { children: ReactNode }) {
  return (
    <View style={{ gap: 16, paddingTop: 16, paddingBottom: 24 }}>
      {children}
    </View>
  );
}
