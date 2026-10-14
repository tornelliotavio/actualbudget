import * as api from '@actual-app/api';
import { z } from 'zod';

import type { ToolRegistrar } from './context';
import { jsonResult, toAmount } from './format';

/** The fields of a card bill this tool reports, amounts in cents. */
export type CardBillSummary = {
  referenceMonth: string;
  closingDate: string;
  effectiveDueDate: string;
  status: string;
  total: number;
  projectedCharges: number;
  paid: number;
  remaining: number;
  minimumPayment: number | null;
  complete: boolean;
};

export function describeCardBill(bill: CardBillSummary) {
  const isClosed = bill.status !== 'open' && bill.status !== 'upcoming';
  return {
    month: bill.referenceMonth,
    closing_date: bill.closingDate,
    due_date: bill.effectiveDueDate,
    status: bill.status,
    total: toAmount(bill.total),
    projected_installments: toAmount(bill.projectedCharges),
    paid: toAmount(bill.paid),
    remaining: toAmount(isClosed ? bill.remaining : bill.total),
    minimum: bill.minimumPayment == null ? null : toAmount(bill.minimumPayment),
    ...(bill.complete ? {} : { history_incomplete: true }),
  };
}

/**
 * The bill the card is on now and the ones after it, up to `count` bills.
 * Bills come oldest first.
 */
export function selectCardBills<
  T extends Pick<CardBillSummary, 'referenceMonth'>,
>(bills: readonly T[], currentMonth: string | null, count: number): T[] {
  const start = bills.findIndex(bill => bill.referenceMonth === currentMonth);
  return start === -1 ? [] : bills.slice(start, start + count);
}

export const registerCardBillTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    'get_card_bills',
    {
      title: 'Credit card bills',
      description:
        'The bills (faturas) of every credit card account, month by month: the bill the card is on now (the oldest closed bill still unpaid, otherwise the open one) and the ones after it. Each bill has its closing and due dates, status (upcoming, open, closed, partially_paid, paid, overdue), total, the part of it that is projected installments, amount paid, amount remaining and minimum payment. Also each card limit, and the total due per month across cards. A bill is named after the month it is due in.',
      inputSchema: {
        months: z
          .number()
          .int()
          .min(1)
          .max(24)
          .optional()
          .describe(
            'How many bills to list per card, from the current one (default 4).',
          ),
      },
      annotations: { readOnlyHint: true },
    },
    ({ months = 4 }) =>
      ctx.session.read(async lib => {
        const { data: accounts } = (await api.aqlQuery(
          api
            .q('accounts')
            .filter({ closed: false, kind: 'credit_card' })
            .select(['id', 'name']),
        )) as { data: { id: string; name: string }[] };

        const cards = [];
        const dueByMonth = new Map<string, number>();
        for (const account of accounts) {
          const result = await lib.send('credit-card-bills', {
            accountId: account.id,
          });
          if (result.status !== 'ok') {
            cards.push({ account: account.name, status: result.status });
            continue;
          }
          const bills = selectCardBills(
            result.bills,
            result.currentMonth,
            months,
          );
          for (const bill of bills) {
            const isClosed =
              bill.status !== 'open' && bill.status !== 'upcoming';
            const due = isClosed ? bill.remaining : bill.total;
            dueByMonth.set(
              bill.referenceMonth,
              (dueByMonth.get(bill.referenceMonth) ?? 0) + due,
            );
          }
          cards.push({
            account: account.name,
            limit:
              result.limit.total == null
                ? null
                : {
                    total: toAmount(result.limit.total),
                    used: toAmount(result.limit.used),
                    available: toAmount(result.limit.available ?? 0),
                  },
            bills: bills.map(describeCardBill),
          });
        }

        return jsonResult({
          cards,
          due_by_month: [...dueByMonth]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, cents]) => ({ month, amount: toAmount(cents) })),
        });
      }),
  );
};
