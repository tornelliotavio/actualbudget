import * as api from '@actual-app/api';
import { z } from 'zod';

import type { ToolRegistrar } from './context';
import {
  addDays,
  between,
  currentDay,
  jsonResult,
  toAmount,
  toCents,
} from './format';
import { loadLookups } from './lookups';
import type { Lookups } from './lookups';
import {
  describeTransaction,
  getTransaction,
  patchTransaction,
} from './transactions';

type Schedule = Awaited<ReturnType<typeof api.getSchedules>>[number];
type RecurConfig = {
  start: string;
  frequency: string;
  interval?: number;
  endMode?: string;
  endDate?: string;
};
type Linked = { schedule: string; date: string; amount: number };

const UPCOMING_DAYS = 7;
// Actual counts a payment against an occurrence from two days before it.
const EARLY_PAYMENT_DAYS = 2;
const CANDIDATE_LOOKBACK_DAYS = 20;

export type ScheduleStatus =
  | 'completed'
  | 'paid'
  | 'due'
  | 'upcoming'
  | 'missed'
  | 'scheduled';

export function scheduleStatus(
  nextDate: string,
  completed: boolean,
  paidDates: string[],
  today: string,
): ScheduleStatus {
  if (completed) return 'completed';
  if (paidDates.some(d => d >= addDays(nextDate, -EARLY_PAYMENT_DAYS))) {
    return 'paid';
  }
  if (nextDate === today) return 'due';
  if (nextDate > today && nextDate <= addDays(today, UPCOMING_DAYS)) {
    return 'upcoming';
  }
  return nextDate < today ? 'missed' : 'scheduled';
}

export function amountRange(amount: unknown, op: string | undefined) {
  if (amount && typeof amount === 'object' && 'num1' in amount) {
    const { num1, num2 } = amount as { num1: number; num2: number };
    return { min: Math.min(num1, num2), max: Math.max(num1, num2) };
  }
  const value = Number(amount ?? 0);
  // isapprox tolerates 7.5% either way, matching Actual's rule engine.
  const slack = op === 'isapprox' ? Math.round(Math.abs(value) * 0.075) : 0;
  return { min: value - slack, max: value + slack };
}

function describeAmount(amount: unknown, op: string | undefined) {
  const { min, max } = amountRange(amount, op);
  if (op === 'isbetween') return `${toAmount(min)} to ${toAmount(max)}`;
  const value = toAmount(Number(amount ?? 0));
  return op === 'isapprox' ? `about ${value}` : `${value}`;
}

function describeRecurrence(date: unknown) {
  if (typeof date === 'string') return `once on ${date}`;
  const config = date as RecurConfig;
  const every =
    (config.interval ?? 1) === 1
      ? config.frequency
      : `every ${config.interval} ${config.frequency}`;
  const ends = config.endMode === 'on_date' ? ` until ${config.endDate}` : '';
  return `${every} from ${config.start}${ends}`;
}

// Schedules link to the parent of a split, which the default inline view hides.
async function linkedTransactions(): Promise<Linked[]> {
  const { data } = (await api.aqlQuery(
    api
      .q('transactions')
      .filter({ schedule: { $ne: null } })
      .select(['schedule', 'date', 'amount'])
      .options({ splits: 'none' })
      .orderBy({ date: 'desc' }),
  )) as { data: Linked[] };
  return data;
}

type CandidateRow = Parameters<typeof describeTransaction>[0];

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Scores how likely a transaction is to be the payment for a schedule. Bank
 * imports often arrive without the payee the schedule expects, so the payee
 * name appearing in the bank description counts nearly as much as the payee.
 */
export function scoreCandidate(
  t: { payee: string | null; notes: string | null; amount: number },
  schedule: { payee?: string | null; amount?: unknown; amountOp?: string },
  payeeName: string | null,
) {
  const { min, max } = amountRange(schedule.amount, schedule.amountOp);
  let score = 0;
  if (schedule.payee && t.payee === schedule.payee) score += 3;
  if (
    payeeName &&
    payeeName.length >= 4 &&
    normalize(t.notes ?? '').includes(normalize(payeeName))
  ) {
    score += 2;
  }
  if (t.amount >= min && t.amount <= max) {
    score += 2;
  } else if (t.amount >= min * 1.25 && t.amount <= max * 0.75) {
    score += 1;
  }
  return score;
}

async function paymentCandidates(
  schedule: Schedule,
  today: string,
  lookups: Lookups,
) {
  const { data } = (await api.aqlQuery(
    api
      .q('transactions')
      .filter({
        $and: [
          schedule.account ? { account: schedule.account } : {},
          { schedule: null, transfer_id: null, projected: false },
          {
            date: between(
              addDays(schedule.next_date ?? today, -CANDIDATE_LOOKBACK_DAYS),
              today,
            ),
          },
        ],
      })
      .select('*')
      .options({ splits: 'none' }),
  )) as { data: CandidateRow[] };
  const payeeName = lookups.payeeName(schedule.payee);
  return data
    .map(t => ({ t, score: scoreCandidate(t, schedule, payeeName) }))
    .filter(({ score }) => score >= 3)
    .sort((a, b) => b.score - a.score || b.t.date.localeCompare(a.t.date))
    .slice(0, 5)
    .map(({ t }) => t);
}

function describeSchedule(
  schedule: Schedule,
  linked: Linked[],
  lookups: Lookups,
  today: string,
) {
  const own = linked.filter(l => l.schedule === schedule.id);
  const status = scheduleStatus(
    schedule.next_date ?? today,
    Boolean(schedule.completed),
    own.map(l => l.date),
    today,
  );
  return {
    id: schedule.id,
    name: schedule.name,
    status,
    next_date: schedule.next_date,
    payee: lookups.payeeName(schedule.payee),
    account: lookups.accountName(schedule.account),
    amount: describeAmount(schedule.amount, schedule.amountOp),
    recurrence: describeRecurrence(schedule.date),
    auto_posts: Boolean(schedule.posts_transaction),
    recent_payments: own
      .slice(0, 3)
      .map(l => ({ date: l.date, amount: toAmount(l.amount) })),
  };
}

const recurrenceSchema = {
  start_date: z.string().describe('YYYY-MM-DD of the first occurrence'),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).optional(),
  end_date: z.string().optional(),
};

const amountSchema = {
  amount: z.number().describe('Signed decimal; bills are negative'),
  amount_op: z.enum(['is', 'isapprox', 'isbetween']).optional(),
  amount_max: z
    .number()
    .optional()
    .describe('Other end of the range when amount_op is isbetween'),
};

const operation = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('link'),
    schedule: z.string().describe('Schedule id or name'),
    transaction_ids: z.array(z.string()).min(1),
  }),
  z.object({
    op: z.literal('skip'),
    schedule: z.string(),
    until: z
      .string()
      .optional()
      .describe(
        'Keep skipping occurrences until next_date is on or after this date. Without it, skips one.',
      ),
  }),
  z.object({
    op: z.literal('post'),
    schedule: z.string(),
  }),
  z.object({
    op: z.literal('create'),
    name: z.string(),
    payee: z.string().optional(),
    account: z.string().optional(),
    auto_post: z.boolean().optional(),
    ...amountSchema,
    ...recurrenceSchema,
  }),
  z.object({
    op: z.literal('update'),
    schedule: z.string(),
    name: z.string().optional(),
    payee: z.string().optional(),
    account: z.string().optional(),
    auto_post: z.boolean().optional(),
    amount: amountSchema.amount.optional(),
    amount_op: amountSchema.amount_op,
    amount_max: amountSchema.amount_max,
    start_date: recurrenceSchema.start_date.optional(),
    frequency: recurrenceSchema.frequency.optional(),
    interval: recurrenceSchema.interval,
    end_date: recurrenceSchema.end_date,
  }),
  z.object({ op: z.literal('delete'), schedule: z.string() }),
]);

function buildAmount(amount: number, op?: string, max?: number) {
  if (op === 'isbetween') {
    if (max == null) throw new Error('amount_max is required for isbetween.');
    return { num1: toCents(amount), num2: toCents(max) };
  }
  return toCents(amount);
}

function buildRecurrence(args: {
  start_date: string;
  frequency: string;
  interval?: number;
  end_date?: string;
}) {
  return {
    start: args.start_date,
    frequency: args.frequency,
    interval: args.interval ?? 1,
    patterns: [],
    skipWeekend: false,
    weekendSolveMode: 'after',
    endMode: args.end_date ? 'on_date' : 'never',
    endOccurrences: 1,
    endDate: args.end_date ?? args.start_date,
  };
}

export const registerScheduleTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    'list_schedules',
    {
      title: 'List schedules',
      description:
        'Recurring bills and income with their status (missed, due, upcoming, paid, scheduled, completed), next date, and recent linked payments. For missed and due schedules it also lists unlinked transactions that look like the payment, so they can be linked with manage_schedules.',
      inputSchema: {
        status: z
          .array(
            z.enum([
              'missed',
              'due',
              'upcoming',
              'paid',
              'scheduled',
              'completed',
            ]),
          )
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ status }) =>
      ctx.session.read(async () => {
        const today = currentDay();
        const lookups = await loadLookups();
        const linked = await linkedTransactions();
        const schedules = await api.getSchedules();
        const described = [];
        for (const schedule of schedules) {
          const summary = describeSchedule(schedule, linked, lookups, today);
          if (status && !status.includes(summary.status)) continue;
          const candidates =
            summary.status === 'missed' || summary.status === 'due'
              ? (await paymentCandidates(schedule, today, lookups)).map(t =>
                  describeTransaction(t, lookups),
                )
              : undefined;
          described.push(candidates ? { ...summary, candidates } : summary);
        }
        described.sort((a, b) =>
          String(a.next_date).localeCompare(String(b.next_date)),
        );
        return jsonResult({ today, schedules: described });
      }),
  );

  server.registerTool(
    'manage_schedules',
    {
      title: 'Manage schedules',
      description: [
        'Operations on schedules, run in order.',
        'link: attach paid transactions to a schedule.',
        "skip: move next_date past occurrences that were paid or will not happen (Actual's Skip next date); a payment made more than two days early does not count toward the occurrence, so link and then skip.",
        'post: create the scheduled transaction now.',
        'create / update / delete: edit the schedule itself.',
      ].join(' '),
      inputSchema: { operations: z.array(operation).min(1).max(50) },
    },
    ({ operations }) =>
      ctx.session.write(async lib => {
        const lookups = await loadLookups();
        const schedules = await api.getSchedules();
        const scheduleId = (ref: string) => {
          const match =
            schedules.find(s => s.id === ref) ??
            schedules.find(
              s => s.name?.toLowerCase() === ref.trim().toLowerCase(),
            );
          if (!match) throw new Error(`No schedule matches "${ref}".`);
          return match.id;
        };
        const nextDate = async (id: string) =>
          (await api.getSchedules()).find(s => s.id === id)?.next_date;
        const done: string[] = [];

        for (const operation of operations) {
          switch (operation.op) {
            case 'link': {
              const id = scheduleId(operation.schedule);
              for (const txId of operation.transaction_ids) {
                await getTransaction(txId);
                await patchTransaction(lib, txId, { schedule: id });
              }
              done.push(
                `linked ${operation.transaction_ids.length} to ${operation.schedule}`,
              );
              break;
            }
            case 'skip': {
              const id = scheduleId(operation.schedule);
              const from = await nextDate(id);
              let skips = 0;
              if (operation.until) {
                while (
                  skips < 36 &&
                  String(await nextDate(id)) < operation.until
                ) {
                  await lib.send('schedule/skip-next-date', { id });
                  skips++;
                }
              } else {
                await lib.send('schedule/skip-next-date', { id });
              }
              done.push(
                `skipped ${operation.schedule} from ${from} to ${await nextDate(id)}`,
              );
              break;
            }
            case 'post': {
              const id = scheduleId(operation.schedule);
              await lib.send('schedule/post-transaction', { id });
              done.push(`posted ${operation.schedule}`);
              break;
            }
            case 'create': {
              const id = await api.createSchedule({
                name: operation.name,
                posts_transaction: operation.auto_post ?? false,
                payee: operation.payee
                  ? lookups.payeeId(operation.payee)
                  : undefined,
                account: operation.account
                  ? lookups.accountId(operation.account)
                  : undefined,
                amount: buildAmount(
                  operation.amount,
                  operation.amount_op,
                  operation.amount_max,
                ),
                amountOp: operation.amount_op ?? 'isapprox',
                date: buildRecurrence(operation),
              } as Parameters<typeof api.createSchedule>[0]);
              done.push(`created ${operation.name} (${id})`);
              break;
            }
            case 'update': {
              const id = scheduleId(operation.schedule);
              const fields: Record<string, unknown> = {};
              if (operation.name) fields.name = operation.name;
              if (operation.auto_post !== undefined) {
                fields.posts_transaction = operation.auto_post;
              }
              if (operation.payee) {
                fields.payee = lookups.payeeId(operation.payee);
              }
              if (operation.account) {
                fields.account = lookups.accountId(operation.account);
              }
              if (operation.amount !== undefined) {
                fields.amount = buildAmount(
                  operation.amount,
                  operation.amount_op,
                  operation.amount_max,
                );
              }
              if (operation.amount_op) fields.amountOp = operation.amount_op;
              if (operation.start_date && operation.frequency) {
                fields.date = buildRecurrence({
                  start_date: operation.start_date,
                  frequency: operation.frequency,
                  interval: operation.interval,
                  end_date: operation.end_date,
                });
              }
              await api.updateSchedule(id, fields, Boolean(fields.date));
              done.push(`updated ${operation.schedule}`);
              break;
            }
            case 'delete':
              await api.deleteSchedule(scheduleId(operation.schedule));
              done.push(`deleted ${operation.schedule}`);
              break;
            default:
              throw new Error('Unknown operation');
          }
        }
        ctx.audit.record({
          tool: 'manage_schedules',
          summary: done.join('; '),
          details: operations,
        });
        return jsonResult({ done });
      }),
  );
};
