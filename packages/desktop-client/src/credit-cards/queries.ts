import { send } from '@actual-app/core/platform/client/connection';
import { queryOptions } from '@tanstack/react-query';

export const creditCardQueries = {
  all: ['credit-cards'] as const,
  list: () =>
    queryOptions({
      queryKey: [...creditCardQueries.all, 'list'],
      queryFn: () => send('credit-cards-list'),
    }),
  projection: (cardId: string, today: string) =>
    queryOptions({
      queryKey: [...creditCardQueries.all, 'projection', cardId, today],
      queryFn: async () => {
        const result = await send('credit-cards-projection', {
          cardId,
          today,
        });
        if ('error' in result) {
          throw new Error(result.error);
        }
        return result;
      },
    }),
  transactions: (cardId: string) =>
    queryOptions({
      queryKey: [...creditCardQueries.all, 'transactions', cardId],
      queryFn: async () => {
        const result = await send('credit-cards-transactions', { cardId });
        if ('error' in result) {
          throw new Error(result.error);
        }
        return result;
      },
    }),
};
