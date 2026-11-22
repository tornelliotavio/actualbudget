import * as api from '@actual-app/api';
import { z } from 'zod';

import type { ToolRegistrar } from './context';
import { jsonResult, toAmount } from './format';
import { loadLookups } from './lookups';
import { describeTransaction, getTransaction } from './transactions';

/**
 * Dismissing is safe only when what it removes is exactly what the bank
 * balance does not have: then nothing real can go with it. Cents throughout.
 */
export function dismissalLeavesBankBalance({
  balance,
  bankReported,
  dismissed,
}: {
  balance: number;
  bankReported: number;
  dismissed: number;
}) {
  return balance - dismissed === bankReported;
}

async function accountBalance(accountId: string) {
  const { data } = (await api.aqlQuery(
    api
      .q('transactions')
      .filter({ account: accountId })
      .calculate({ $sum: '$amount' }),
  )) as { data: number | null };
  return data ?? 0;
}

export const registerBankImportTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    'dismiss_bank_transactions',
    {
      title: 'Dismiss bank transactions that are not in the account',
      description:
        "Delete bank-imported transactions of one account and keep bank sync from importing them again, for rows the bank sends that are not part of the account (e.g. a savings box's own statement mixed into the account's). Only plain imported rows: no transfers, splits or rows added by hand. Refused unless the account's balance minus the dismissed rows equals the balance the bank reports, so the whole set has to be dismissed at once.",
      inputSchema: {
        account: z.string().describe('Account name or id'),
        transaction_ids: z.array(z.string()).min(1).max(200),
      },
      annotations: { destructiveHint: true },
    },
    ({ account, transaction_ids }) =>
      ctx.session.write(async lib => {
        const lookups = await loadLookups();
        const accountId = lookups.accountId(account);
        const bankAccount = (await api.getAccounts()).find(
          a => a.id === accountId,
        );
        const bankReported = bankAccount?.balance_current;
        if (bankReported == null) {
          throw new Error(
            `${lookups.accountName(accountId)} has no balance from the bank.`,
          );
        }

        const ids = [...new Set(transaction_ids)];
        const rows = [];
        for (const id of ids) {
          const row = await getTransaction(id);
          if (row.account !== accountId) {
            throw new Error(
              `Transaction ${id} is in ${lookups.accountName(row.account)}.`,
            );
          }
          rows.push(row);
        }

        const balance = await accountBalance(accountId);
        const dismissed = rows.reduce((total, row) => total + row.amount, 0);
        if (!dismissalLeavesBankBalance({ balance, bankReported, dismissed })) {
          throw new Error(
            `Dismissing these would leave ${toAmount(balance - dismissed)} against ${toAmount(bankReported)} reported by the bank (difference now ${toAmount(balance - bankReported)}, these add up to ${toAmount(dismissed)}). Nothing was changed.`,
          );
        }

        const before = rows.map(row => describeTransaction(row, lookups));
        await lib.send('transactions-dismiss-imported', { ids });
        ctx.audit.record({
          tool: 'dismiss_bank_transactions',
          summary: `Dismissed ${ids.length} bank transactions in ${lookups.accountName(accountId)} (${toAmount(dismissed)})`,
          details: { before },
        });
        return jsonResult({
          dismissed: before,
          total: toAmount(dismissed),
          balance: toAmount(balance - dismissed),
          bank_reported: toAmount(bankReported),
        });
      }),
  );
};
