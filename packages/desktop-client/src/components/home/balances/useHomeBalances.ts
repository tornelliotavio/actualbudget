import type { AccountEntity } from '@actual-app/core/types/models';

import { useAccountBalances } from '#hooks/useAccountBalances';
import { useAccounts } from '#hooks/useAccounts';

export type HomeAccountBalance = {
  account: AccountEntity;
  balance: number | null;
};

/**
 * Open accounts with their balances: cash (on-budget, not cards), cards and
 * off-budget accounts, each in sidebar order.
 */
export function useHomeBalances() {
  const { data: accounts = [], isLoading } = useAccounts();
  const open = accounts.filter(account => !account.closed);
  const balances = useAccountBalances(open.map(account => account.id));

  const withBalance = (list: AccountEntity[]): HomeAccountBalance[] =>
    list.map(account => ({ account, balance: balances[account.id] ?? null }));

  const cash = withBalance(
    open.filter(
      account => !account.offbudget && account.kind !== 'credit_card',
    ),
  );
  const cards = withBalance(
    open.filter(account => account.kind === 'credit_card'),
  );
  const offBudget = withBalance(
    open.filter(account => account.offbudget && account.kind !== 'credit_card'),
  );

  return {
    cash,
    cards,
    offBudget,
    cashTotal: cash.reduce((sum, row) => sum + (row.balance ?? 0), 0),
    isLoading: isLoading || cash.some(row => row.balance == null),
  };
}
