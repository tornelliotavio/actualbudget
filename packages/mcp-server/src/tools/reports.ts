import * as api from '@actual-app/api';
import { z } from 'zod';

import type { ToolRegistrar } from './context';
import { addDays, between, jsonResult, toAmount } from './format';
import { loadLookups } from './lookups';

type Grouping = 'category' | 'group' | 'payee' | 'month';
type Row = { key: string | null; total: number; count: number };

const GROUP_FIELDS: Record<Exclude<Grouping, 'month'>, string> = {
  category: 'category',
  group: 'category.group',
  payee: 'payee',
};

function daysBetween(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
      86_400_000,
  );
}

/** Whole calendar months compare with the same number of preceding months. */
export function previousPeriod(start: string, end: string) {
  const previousEnd = addDays(start, -1);
  if (start.endsWith('-01') && addDays(end, 1).endsWith('-01')) {
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const months = (ey - sy) * 12 + (em - sm) + 1;
    const first = new Date(Date.UTC(sy, sm - 1 - months, 1));
    return { start: first.toISOString().slice(0, 10), end: previousEnd };
  }
  return {
    start: addDays(previousEnd, -daysBetween(start, end)),
    end: previousEnd,
  };
}

async function totals(
  start: string,
  end: string,
  groupBy: Grouping,
  account?: string,
): Promise<Row[]> {
  const filter = {
    date: between(start, end),
    'account.offbudget': false,
    transfer_id: null,
    // Future card installments are not spending yet.
    projected: false,
    ...(account ? { account } : {}),
  };
  const field = groupBy === 'month' ? 'date' : GROUP_FIELDS[groupBy];
  const { data } = (await api.aqlQuery(
    api
      .q('transactions')
      .filter(filter)
      .groupBy(field)
      .select([
        { key: field },
        { total: { $sum: '$amount' } },
        { count: { $count: '$id' } },
      ]),
  )) as { data: Row[] };
  if (groupBy !== 'month') return data;

  const byMonth = new Map<string, Row>();
  for (const row of data) {
    const month = String(row.key).slice(0, 7);
    const current = byMonth.get(month) ?? { key: month, total: 0, count: 0 };
    byMonth.set(month, {
      key: month,
      total: current.total + row.total,
      count: current.count + row.count,
    });
  }
  return [...byMonth.values()];
}

export const registerReportTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    'spending_report',
    {
      title: 'Spending report',
      description:
        'Totals for on-budget transactions in a date range, excluding transfers, grouped by category, category group, payee or month. Negative totals are spending. Optionally compares with the previous period of the same length.',
      inputSchema: {
        start_date: z.string().describe('YYYY-MM-DD, inclusive'),
        end_date: z.string().describe('YYYY-MM-DD, inclusive'),
        group_by: z.enum(['category', 'group', 'payee', 'month']).optional(),
        account: z.string().optional(),
        compare_previous: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    args =>
      ctx.session.read(async () => {
        const lookups = await loadLookups();
        const groupBy = args.group_by ?? 'category';
        const account = args.account
          ? lookups.accountId(args.account)
          : undefined;
        const groups = await api.getCategoryGroups();
        const groupNames = new Map(groups.map(g => [g.id, g.name]));
        const label = (key: string | null) => {
          if (key == null) {
            return groupBy === 'payee' ? '(no payee)' : '(uncategorized)';
          }
          if (groupBy === 'category') return lookups.categoryName(key);
          if (groupBy === 'group') return groupNames.get(key) ?? key;
          if (groupBy === 'payee') return lookups.payeeName(key);
          return key;
        };

        const current = await totals(
          args.start_date,
          args.end_date,
          groupBy,
          account,
        );
        let previous: Map<string | null, number> | undefined;
        let previousRange: { start: string; end: string } | undefined;
        if (args.compare_previous) {
          previousRange = previousPeriod(args.start_date, args.end_date);
          previous = new Map(
            (
              await totals(
                previousRange.start,
                previousRange.end,
                groupBy,
                account,
              )
            ).map(r => [r.key, r.total]),
          );
        }

        const rows = current
          .map(r => ({
            name: label(r.key),
            total: toAmount(r.total),
            count: r.count,
            ...(previous
              ? { previous_total: toAmount(previous.get(r.key) ?? 0) }
              : {}),
          }))
          .sort((a, b) =>
            groupBy === 'month'
              ? String(a.name).localeCompare(String(b.name))
              : a.total - b.total,
          );
        const sum = (sign: 1 | -1) =>
          toAmount(
            current
              .filter(r => Math.sign(r.total) === sign)
              .reduce((s, r) => s + r.total, 0),
          );
        return jsonResult({
          range: { start: args.start_date, end: args.end_date },
          group_by: groupBy,
          ...(previousRange ? { previous_range: previousRange } : {}),
          inflow: sum(1),
          outflow: sum(-1),
          rows,
        });
      }),
  );

  server.registerTool(
    'run_query',
    {
      title: 'Run an ActualQL query',
      description: [
        'Read-only escape hatch for questions the other tools do not cover.',
        'Tables: transactions, accounts, categories, category_groups, payees, schedules, rules.',
        'Filters use Mongo-style operators ($eq, $ne, $lt, $lte, $gt, $gte, $oneof, $like, $notlike, $regexp, $and, $or) and dotted paths such as "category.name" or "account.offbudget".',
        'Amounts are integer cents here. Example: {"table":"transactions","filter":{"date":{"$gte":"2026-09-01"}},"select":["date","amount","notes","category.name"],"limit":20}.',
      ].join(' '),
      inputSchema: {
        table: z.string(),
        filter: z.record(z.string(), z.any()).optional(),
        select: z.array(z.any()).optional(),
        group_by: z.array(z.string()).optional(),
        order_by: z.array(z.any()).optional(),
        calculate: z.any().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        splits: z.enum(['inline', 'grouped', 'all', 'none']).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    args =>
      ctx.session.read(async () => {
        let query = api.q(args.table);
        if (args.filter) query = query.filter(args.filter);
        if (args.splits) query = query.options({ splits: args.splits });
        if (args.group_by) query = query.groupBy(args.group_by);
        if (args.order_by) query = query.orderBy(args.order_by);
        if (args.calculate) {
          query = query.calculate(args.calculate);
        } else {
          query = query.select(args.select ?? ['*']).limit(args.limit ?? 200);
        }
        const { data } = (await api.aqlQuery(query)) as { data: unknown };
        return jsonResult(data);
      }),
  );
};
