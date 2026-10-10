import { send } from '@actual-app/core/platform/client/connection';
import type { Handlers } from '@actual-app/core/types/handlers';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { creditCardQueries } from './queries';

type Arg<Name extends keyof Handlers> = Parameters<Handlers[Name]>[0];

function unwrap<T>(value: T | { error: string }): T {
  if (value && typeof value === 'object' && 'error' in value) {
    throw new Error(value.error);
  }
  return value as T;
}

function useRefreshCards() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: creditCardQueries.all });
  };
}

export function useCreateCreditCard() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: Arg<'credit-cards-create'>) =>
      send('credit-cards-create', input).then(unwrap),
    onSuccess: refresh,
  });
}

export function useUpdateCreditCard() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: Arg<'credit-cards-update'>) =>
      send('credit-cards-update', input).then(unwrap),
    onSuccess: refresh,
  });
}

export function useDeleteCreditCard() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (id: string) =>
      send('credit-cards-delete', { id }).then(unwrap),
    onSuccess: refresh,
  });
}

export function useCreatePurchase() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: Arg<'credit-cards-create-purchase'>) =>
      send('credit-cards-create-purchase', input).then(unwrap),
    onSuccess: refresh,
  });
}

export function useConfirmBill() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: Arg<'credit-cards-confirm-bill'>) =>
      send('credit-cards-confirm-bill', input).then(unwrap),
    onSuccess: refresh,
  });
}

export function useAllocatePayment() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: Arg<'credit-cards-allocate-payment'>) =>
      send('credit-cards-allocate-payment', input).then(unwrap),
    onSuccess: refresh,
  });
}

export function useAssignTransactions() {
  const refresh = useRefreshCards();
  return useMutation({
    mutationFn: (input: Arg<'credit-cards-assign-transactions'>) =>
      send('credit-cards-assign-transactions', input).then(unwrap),
    onSuccess: refresh,
  });
}
