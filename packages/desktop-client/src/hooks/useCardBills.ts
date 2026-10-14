import { useEffect } from 'react';

import { listen, send } from '@actual-app/core/platform/client/connection';
import type { CardBillsResult } from '@actual-app/core/server/credit-cards/bills';
import type { AccountEntity } from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

const CARD_TABLES = [
  'transactions',
  'card_bills',
  'card_profiles',
  'card_purchases',
  'accounts',
];

function useRefetchOnCardChanges(refetch: () => unknown, enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return listen('sync-event', event => {
      if (
        event.type === 'applied' &&
        event.tables.some(table => CARD_TABLES.includes(table))
      ) {
        void refetch();
      }
    });
  }, [refetch, enabled]);
}

/** Bills of a credit card account, kept current as its data changes. */
export function useCardBills(accountId: AccountEntity['id'] | undefined) {
  const query = useQuery<CardBillsResult>({
    queryKey: ['credit-card-bills', accountId],
    queryFn: () => send('credit-card-bills', { accountId: accountId! }),
    enabled: accountId != null,
  });
  useRefetchOnCardChanges(query.refetch, accountId != null);
  return query;
}

/** Bills of several card accounts, in the order given. */
export function useAllCardBills(accountIds: Array<AccountEntity['id']>) {
  const query = useQuery({
    queryKey: ['credit-card-bills-all', ...accountIds],
    queryFn: () =>
      Promise.all(
        accountIds.map(accountId =>
          send('credit-card-bills', { accountId }).then(result => ({
            accountId,
            result,
          })),
        ),
      ),
  });
  useRefetchOnCardChanges(query.refetch, true);
  return query;
}
