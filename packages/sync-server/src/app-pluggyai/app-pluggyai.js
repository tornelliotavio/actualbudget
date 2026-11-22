import express from 'express';

import { isAdmin } from '#account-db';
import { handleError } from '#app-gocardless/util/handle-error';
import { SecretName, secretsService } from '#services/secrets-service';
import * as UserService from '#services/user-service';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from '#util/middlewares';
import { isValidFileId } from '#util/paths';

import { pluggyaiService } from './pluggyai-service';
import {
  getDate,
  isSavingsBoxMirror,
  toActualBill,
  toActualCreditData,
  toActualTransaction,
} from './pluggyai-transform';

const app = express();
export { app as handlers };
app.use(requestLoggerMiddleware);
app.use(express.json());
app.use(validateSessionMiddleware);

function canAccessFile(fileId, userId) {
  return isAdmin(userId) || UserService.countUserAccess(fileId, userId) > 0;
}

app.post(
  '/status',
  handleError(async (req, res) => {
    const fileId = req.get('X-Actual-File-Id');
    if (!!fileId) {
      if (!isValidFileId(fileId)) {
        res.status(400).send({
          status: 'error',
          reason: 'invalid-file-id',
          details: 'invalid fileId',
        });
        return;
      }

      if (!canAccessFile(fileId, res.locals.user_id)) {
        res.status(403).send({
          status: 'error',
          reason: 'file-access-denied',
          details: "You don't have permissions over this file",
        });
        return;
      }
    }

    const source = pluggyaiService.getCredentialSource(fileId);

    res.send({
      status: 'ok',
      data: {
        configured: !!source,
        source,
      },
    });
  }),
);

app.post(
  '/accounts',
  handleError(async (req, res) => {
    const fileId = req.get('X-Actual-File-Id');
    if (!!fileId) {
      if (!isValidFileId(fileId)) {
        res.status(400).send({
          status: 'error',
          reason: 'invalid-file-id',
          details: 'invalid fileId',
        });
        return;
      }

      if (!canAccessFile(fileId, res.locals.user_id)) {
        res.status(403).send({
          status: 'error',
          reason: 'file-access-denied',
          details: "You don't have permissions over this file",
        });
        return;
      }
    }

    try {
      const source = pluggyaiService.getCredentialSource(fileId);
      if (!source) {
        res.status(400).send({
          status: 'error',
          reason: 'not-configured',
          details: 'Pluggy credentials are not configured',
        });
        return;
      }

      const credentialFileId = source === 'per-budget-file' ? fileId : null;
      const itemIds = (
        secretsService.get(SecretName.pluggyai_itemIds, credentialFileId) ?? ''
      )
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

      let accounts = [];

      for (const item of itemIds) {
        const partial = await pluggyaiService.getAccountsByItemId(item, fileId);
        accounts = accounts.concat(partial.results);
      }

      res.send({
        status: 'ok',
        data: {
          accounts,
        },
      });
    } catch (error) {
      res.send({
        status: 'ok',
        data: {
          error: error.message,
        },
      });
    }
  }),
);

app.post(
  '/transactions',
  handleError(async (req, res) => {
    const { accountId, startDate, createdAtFrom } = req.body || {};
    const fileId = req.get('X-Actual-File-Id');
    if (!!fileId) {
      if (!isValidFileId(fileId)) {
        res.status(400).send({
          status: 'error',
          reason: 'invalid-file-id',
          details: 'invalid fileId',
        });
        return;
      }

      if (!canAccessFile(fileId, res.locals.user_id)) {
        res.status(403).send({
          status: 'error',
          reason: 'file-access-denied',
          details: "You don't have permissions over this file",
        });
        return;
      }
    }

    try {
      const source = pluggyaiService.getCredentialSource(fileId);
      if (!source) {
        res.status(400).send({
          status: 'error',
          reason: 'not-configured',
          details: 'Pluggy credentials are not configured',
        });
        return;
      }

      const transactions = await pluggyaiService.getTransactionsByAccountId(
        accountId,
        startDate,
        fileId,
        createdAtFrom ?? null,
      );

      const account = await pluggyaiService.getAccountById(accountId, fileId);
      if (account.type === 'BANK') {
        void probeInvestments(account, fileId);
      }

      let startingBalance = parseInt(
        Math.round(account.balance * 100).toString(),
      );
      if (account.type === 'CREDIT') {
        startingBalance = -startingBalance;
      }
      const date = getDate(account.updatedAt);

      const balances = [
        {
          balanceAmount: {
            amount: startingBalance,
            currency: account.currencyCode,
          },
          balanceType: 'expected',
          referenceDate: date,
        },
      ];

      const all = [];
      const booked = [];
      const pending = [];

      for (const trans of Object.values(transactions)) {
        if (typeof trans !== 'object' || Object.keys(trans).length === 0) {
          continue;
        }
        if (isSavingsBoxMirror(trans)) {
          continue;
        }

        const finalTrans = toActualTransaction(trans, account.type);

        if (finalTrans.booked) {
          booked.push(finalTrans);
        } else {
          pending.push(finalTrans);
        }
        all.push(finalTrans);
      }

      const sortFunction = (a, b) => b.sortOrder - a.sortOrder;

      res.send({
        status: 'ok',
        data: {
          balances,
          startingBalance,
          transactions: {
            all: all.sort(sortFunction),
            booked: booked.sort(sortFunction),
            pending: pending.sort(sortFunction),
          },
          creditCard:
            account.type === 'CREDIT'
              ? await getCreditCardSnapshot(account, fileId)
              : null,
        },
      });
    } catch (error) {
      res.send({
        status: 'ok',
        data: {
          error: error.message,
        },
      });
    }
    return;
  }),
);

/**
 * Limits, dates and bills of a card. A failure here doesn't fail the sync:
 * transactions still import, and the card keeps its previous facts.
 */
async function getCreditCardSnapshot(account, fileId) {
  try {
    const [item, bills] = await Promise.all([
      pluggyaiService.getItemById(account.itemId, fileId),
      pluggyaiService.getCreditCardBillsByAccountId(account.id, fileId),
    ]);
    return {
      ...toActualCreditData(account, item?.connector),
      bills: bills.map(toActualBill),
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Temporary, read-only: lists the item's investments in the logs to see
// whether Mercado Pago savings boxes show up there.
async function probeInvestments(account, fileId) {
  const tag = '[pluggy-investments-probe]';
  try {
    const client = pluggyaiService.getClient(fileId);
    const item = await client.fetchItem(account.itemId);
    console.log(
      tag,
      JSON.stringify({
        products: item.products,
        connectorProducts: item.connector?.products,
        connector: item.connector?.name,
        isOpenFinance: item.connector?.isOpenFinance,
      }),
    );
    const accounts = await client.fetchAccounts(account.itemId);
    for (const acc of accounts.results) {
      console.log(
        tag,
        'account',
        JSON.stringify({
          id: acc.id,
          name: acc.name,
          marketingName: acc.marketingName,
          type: acc.type,
          subtype: acc.subtype,
          balance: acc.balance,
        }),
      );
    }
    const page = await client.fetchInvestments(account.itemId);
    console.log(tag, account.name, 'investments:', page.results.length);
    for (const inv of page.results) {
      console.log(
        tag,
        JSON.stringify({
          id: inv.id,
          name: inv.name,
          type: inv.type,
          subtype: inv.subtype,
          status: inv.status,
          balance: inv.balance,
          amount: inv.amount,
          keys: Object.keys(inv),
        }),
      );
      const txs = await client.fetchInvestmentTransactions(inv.id, {
        dateFrom: '2026-11-14',
      });
      for (const t of txs.results) {
        console.log(
          tag,
          inv.name,
          JSON.stringify({
            id: t.id,
            date: t.date,
            amount: t.amount,
            value: t.value,
            type: t.type,
            movementType: t.movementType,
            description: t.description,
          }),
        );
      }
    }
  } catch (error) {
    console.log(tag, 'failed:', error.message);
  }
}
