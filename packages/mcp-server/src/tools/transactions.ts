import * as api from '@actual-app/api';
import { z } from 'zod';

import type { Lib } from '#budget';

import type { ToolRegistrar } from './context';
import { jsonResult, toAmount, toCents } from './format';
import { loadLookups } from './lookups';
import type { Lookups } from './lookups';

type TransactionRow = {
  id: string;
  date: string;
  amount: number;
  account: string;
  payee: string | null;
  category: string | null;
  notes: string | null;
  imported_payee: string | null;
  cleared: boolean;
  reconciled: boolean;
  schedule: string | null;
  transfer_id: string | null;
  parent_id: string | null;
  card_bill: string | null;
  installment_number: number | null;
  installment_count: number | null;
  projected: boolean;
};

const FIELDS = [
  'id',
  'date',
  'amount',
  'account',
  'payee',
  'category',
  'notes',
  'imported_payee',
  'cleared',
  'reconciled',
  'schedule',
  'transfer_id',
  'parent_id',
  'card_bill',
  'installment_number',
  'installment_count',
  'projected',
];

export function describeTransaction(t: TransactionRow, lookups: Lookups) {
  return {
    id: t.id,
    date: t.date,
    account: lookups.accountName(t.account),
    payee: lookups.payeeName(t.payee),
    notes: t.notes,
    category: lookups.categoryName(t.category),
    amount: toAmount(t.amount),
    cleared: t.cleared,
    ...(t.schedule ? { schedule_id: t.schedule } : {}),
    ...(t.transfer_id ? { is_transfer: true } : {}),
    ...(t.parent_id ? { split_of: t.parent_id } : {}),
    // Card bills are `<account id>:<YYYY-MM>`, named after the due month.
    ...(t.card_bill ? { card_bill: t.card_bill.slice(-7) } : {}),
    ...(t.installment_number && t.installment_count
      ? { installment: `${t.installment_number}/${t.installment_count}` }
      : {}),
    ...(t.projected ? { projected: true } : {}),
  };
}

export async function getTransaction(id: string) {
  const { data } = (await api.aqlQuery(
    api.q('transactions').filter({ id }).select(FIELDS),
  )) as { data: TransactionRow[] };
  if (!data[0]) throw new Error(`Transaction ${id} not found.`);
  return data[0];
}

/**
 * Writes fields on one transaction and waits for the write. The API's
 * updateTransaction returns before its batch update lands, so a read right
 * after it sees the old values.
 */
export async function patchTransaction(
  lib: Lib,
  id: string,
  fields: Record<string, unknown>,
) {
  // The entity type has no null category, but null is how one is cleared.
  const updated = { ...fields, id } as Parameters<
    typeof api.updateTransaction
  >[1] & { id: string };
  await lib.send('transactions-batch-update', { updated: [updated] });
}

export const UNCATEGORIZED_FILTER = {
  category: null,
  transfer_id: null,
  'account.offbudget': false,
  // A projected installment gets its category when the real one arrives.
  projected: false,
};

const findSchema = {
  account: z.string().optional().describe('Account name or id'),
  category: z.string().optional().describe('Category name or id'),
  uncategorized: z
    .boolean()
    .optional()
    .describe('Only on-budget, non-transfer transactions with no category'),
  payee: z.string().optional().describe('Payee name or id'),
  text: z
    .string()
    .optional()
    .describe('Case-insensitive substring of the notes or bank description'),
  start_date: z.string().optional().describe('YYYY-MM-DD, inclusive'),
  end_date: z.string().optional().describe('YYYY-MM-DD, inclusive'),
  min_amount: z
    .number()
    .optional()
    .describe('Signed decimal; expenses are negative'),
  max_amount: z.number().optional(),
  schedule_id: z.string().optional(),
  include_projected: z
    .boolean()
    .optional()
    .describe(
      'Include future credit card installments not charged yet (default false)',
    ),
  limit: z.number().int().min(1).max(500).optional().describe('Default 50'),
};

const updateSchema = z.object({
  id: z.string(),
  category: z
    .string()
    .nullable()
    .optional()
    .describe('Category name or id; null clears it'),
  payee: z.string().optional().describe('Existing payee name or id'),
  notes: z.string().optional(),
  cleared: z.boolean().optional(),
  date: z.string().optional().describe('YYYY-MM-DD'),
  amount: z.number().optional().describe('Signed decimal'),
});

export const registerTransactionTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    'find_transactions',
    {
      title: 'Find transactions',
      description:
        'Search transactions, newest first. Split transactions appear as their individual parts. Returns the matching rows plus the count and sum of everything that matched, beyond the limit too. Credit card transactions carry the bill they are on (card_bill, the month it is due) and, for installments, installment ("3/6"); future installments not charged yet are projected and only returned with include_projected.',
      inputSchema: findSchema,
      annotations: { readOnlyHint: true },
    },
    args =>
      ctx.session.read(async () => {
        const lookups = await loadLookups();
        const clauses: Record<string, unknown>[] = [];
        if (args.account) {
          clauses.push({ account: lookups.accountId(args.account) });
        }
        if (args.category) {
          clauses.push({ category: lookups.categoryId(args.category) });
        }
        if (args.uncategorized) clauses.push(UNCATEGORIZED_FILTER);
        if (args.payee) {
          const payee = lookups.payeeId(args.payee);
          if (!payee) throw new Error(`No payee matches "${args.payee}".`);
          clauses.push({ payee });
        }
        if (args.text) {
          const like = `%${args.text}%`;
          clauses.push({
            $or: [
              { notes: { $like: like } },
              { imported_payee: { $like: like } },
            ],
          });
        }
        if (args.start_date) clauses.push({ date: { $gte: args.start_date } });
        if (args.end_date) clauses.push({ date: { $lte: args.end_date } });
        if (args.min_amount != null) {
          clauses.push({ amount: { $gte: toCents(args.min_amount) } });
        }
        if (args.max_amount != null) {
          clauses.push({ amount: { $lte: toCents(args.max_amount) } });
        }
        if (args.schedule_id) clauses.push({ schedule: args.schedule_id });
        if (!args.include_projected) clauses.push({ projected: false });

        const base = api.q('transactions').filter({ $and: clauses });
        const [{ data: rows }, { data: sum }, { data: count }] =
          (await Promise.all([
            api.aqlQuery(
              base
                .select(FIELDS)
                .orderBy([{ date: 'desc' }, { amount: 'asc' }])
                .limit(args.limit ?? 50),
            ),
            api.aqlQuery(base.calculate({ $sum: '$amount' })),
            api.aqlQuery(base.calculate({ $count: '$id' })),
          ])) as [
            { data: TransactionRow[] },
            { data: number },
            { data: number },
          ];

        return jsonResult({
          matched: count,
          total_amount: toAmount(sum ?? 0),
          returned: rows.length,
          transactions: rows.map(t => describeTransaction(t, lookups)),
        });
      }),
  );

  server.registerTool(
    'update_transactions',
    {
      title: 'Update transactions',
      description:
        'Change category, payee, notes, cleared, date or amount on up to 200 transactions at once. Payees must already exist (see manage_payees). Every change is recorded in the audit log with its previous value.',
      inputSchema: { updates: z.array(updateSchema).min(1).max(200) },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ updates }) =>
      ctx.session.write(async lib => {
        const lookups = await loadLookups();
        const results = [];
        for (const update of updates) {
          const before = await getTransaction(update.id);
          const fields: Record<string, unknown> = {};
          if (update.category !== undefined) {
            fields.category =
              update.category === null
                ? null
                : lookups.categoryId(update.category);
          }
          if (update.payee !== undefined) {
            const payee = lookups.payeeId(update.payee);
            if (!payee) throw new Error(`No payee matches "${update.payee}".`);
            fields.payee = payee;
          }
          if (update.notes !== undefined) fields.notes = update.notes;
          if (update.cleared !== undefined) fields.cleared = update.cleared;
          if (update.date !== undefined) fields.date = update.date;
          if (update.amount !== undefined) {
            fields.amount = toCents(update.amount);
          }
          await patchTransaction(lib, update.id, fields);
          const after = await getTransaction(update.id);
          results.push(describeTransaction(after, lookups));
          ctx.audit.record({
            tool: 'update_transactions',
            summary: `Updated ${update.id}`,
            details: {
              before: describeTransaction(before, lookups),
              after: describeTransaction(after, lookups),
            },
          });
        }
        return jsonResult({ updated: results.length, transactions: results });
      }),
  );

  server.registerTool(
    'add_transactions',
    {
      title: 'Add transactions',
      description:
        'Add transactions by hand to one account, e.g. cash spending. Payee names that do not exist yet are created. Rules are not applied; set the category explicitly.',
      inputSchema: {
        account: z.string().describe('Account name or id'),
        transactions: z
          .array(
            z.object({
              date: z.string().describe('YYYY-MM-DD'),
              amount: z.number().describe('Signed decimal; expenses negative'),
              payee: z.string().optional(),
              category: z.string().optional(),
              notes: z.string().optional(),
              cleared: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(100),
      },
    },
    args =>
      ctx.session.write(async () => {
        const lookups = await loadLookups();
        const accountId = lookups.accountId(args.account);
        const transactions = args.transactions.map(t => ({
          date: t.date,
          amount: toCents(t.amount),
          payee_name: t.payee,
          category: t.category ? lookups.categoryId(t.category) : undefined,
          notes: t.notes,
          cleared: t.cleared ?? false,
        }));
        await api.addTransactions(accountId, transactions, {
          runTransfers: true,
        });
        ctx.audit.record({
          tool: 'add_transactions',
          summary: `Added ${transactions.length} to ${lookups.accountName(accountId)}`,
          details: args,
        });
        return jsonResult({ added: transactions.length });
      }),
  );

  server.registerTool(
    'merge_transactions',
    {
      title: 'Merge duplicate transactions',
      description:
        "Merge two transactions in the same account with the same amount into one, the way Actual's Merge action does. The bank-imported one is kept and inherits category, payee, notes, schedule and transfer link from the other.",
      inputSchema: { first_id: z.string(), second_id: z.string() },
      annotations: { destructiveHint: true },
    },
    ({ first_id, second_id }) =>
      ctx.session.write(async () => {
        const lookups = await loadLookups();
        const before = [
          await getTransaction(first_id),
          await getTransaction(second_id),
        ];
        const keptId = await api.mergeTransactions([first_id, second_id]);
        const kept = await getTransaction(keptId);
        ctx.audit.record({
          tool: 'merge_transactions',
          summary: `Merged ${first_id} and ${second_id}`,
          details: {
            before: before.map(t => describeTransaction(t, lookups)),
            kept: describeTransaction(kept, lookups),
          },
        });
        return jsonResult({ kept: describeTransaction(kept, lookups) });
      }),
  );

  server.registerTool(
    'link_transfer',
    {
      title: 'Link two transactions as a transfer',
      description:
        'Turn two existing transactions in different accounts, with opposite amounts, into one transfer, e.g. a card bill payment and the matching payment received on the card. Neither may already be a transfer.',
      inputSchema: { first_id: z.string(), second_id: z.string() },
    },
    ({ first_id, second_id }) =>
      ctx.session.write(async lib => {
        const lookups = await loadLookups();
        const a = await getTransaction(first_id);
        const b = await getTransaction(second_id);
        if (a.account === b.account || a.amount !== -b.amount) {
          throw new Error(
            'A transfer needs two different accounts and opposite amounts.',
          );
        }
        if (a.transfer_id || b.transfer_id) {
          throw new Error('One of these is already a transfer.');
        }
        const payees = await api.getPayees();
        const transferPayee = (account: string) => {
          const payee = payees.find(p => p.transfer_acct === account);
          if (!payee) throw new Error(`No transfer payee for ${account}.`);
          return payee.id;
        };
        const { data: full } = (await api.aqlQuery(
          api
            .q('transactions')
            .filter({ id: { $oneof: [a.id, b.id] } })
            .select('*'),
        )) as { data: Record<string, unknown>[] };
        const row = (id: string) => full.find(t => t.id === id);
        await lib.send('transactions-batch-update', {
          updated: [
            {
              ...row(a.id),
              id: a.id,
              category: null,
              payee: transferPayee(b.account),
              transfer_id: b.id,
            },
            {
              ...row(b.id),
              id: b.id,
              category: null,
              payee: transferPayee(a.account),
              transfer_id: a.id,
            },
          ] as never,
          runTransfers: false,
        });
        ctx.audit.record({
          tool: 'link_transfer',
          summary: `Linked ${a.id} and ${b.id} as a transfer`,
          details: {
            before: [a, b].map(t => describeTransaction(t, lookups)),
          },
        });
        return jsonResult({ linked: [a.id, b.id] });
      }),
  );
};
