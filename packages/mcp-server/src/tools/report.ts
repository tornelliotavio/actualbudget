import { z } from 'zod';

import { collectReport } from '#report/collect';
import { composeReportEmail } from '#report/email';
import { renderReportPdf } from '#report/pdf';
import type { DailyReport } from '#report/types';

import type { ToolRegistrar } from './context';
import { currentDay, jsonResult, toAmount } from './format';

function describeTotals({ totals }: DailyReport) {
  return {
    received: toAmount(totals.received),
    spent: toAmount(totals.spent),
    to_pay: toAmount(totals.toPay),
    paid: toAmount(totals.paid),
    overdue_bills: totals.overdueCount,
    cash: toAmount(totals.cash),
    left_after_bills: toAmount(totals.leftAfterBills),
  };
}

export const registerReportDeliveryTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    'send_daily_report',
    {
      title: 'Email the daily report',
      description:
        "Builds the daily financial report and emails it as a PDF to the owner's configured address: spending by category, what was received, bills and card bills left to pay this month, and account balances. The numbers come from the budget; pass only what happened today. Call it last, after the day's cleanup. With dry_run nothing is sent and the report data comes back. If email isn't configured, the result says so.",
      inputSchema: {
        summary: z
          .string()
          .max(600)
          .optional()
          .describe(
            "One or two sentences on the day, in the owner's language.",
          ),
        corrections: z
          .array(
            z.object({
              description: z.string().max(300),
              count: z.number().int().min(1).optional(),
            }),
          )
          .max(30)
          .optional()
          .describe('What was fixed today.'),
        questions: z
          .array(
            z.object({
              description: z.string().max(300),
              date: z
                .string()
                .optional()
                .describe('YYYY-MM-DD of the transaction, when there is one.'),
              amount: z.number().optional(),
            }),
          )
          .max(30)
          .optional()
          .describe('What needs the owner to decide.'),
        dry_run: z.boolean().optional(),
      },
      annotations: { openWorldHint: true },
    },
    async ({ summary, corrections = [], questions = [], dry_run }) => {
      const data = await ctx.session.read(lib =>
        collectReport(lib, {
          today: currentDay(),
          ignoredCategories: ctx.report.ignoredCategories,
        }),
      );
      const report = { ...data, notes: { summary, corrections, questions } };
      const pdf = await renderReportPdf(report);

      if (dry_run) {
        return jsonResult({ sent: false, pdf_bytes: pdf.length, report });
      }
      if (!ctx.report.mailer) {
        return jsonResult({
          sent: false,
          reason:
            'Email is not configured: set RESEND_API_KEY and REPORT_EMAIL_TO on the actual-mcp service.',
          totals: describeTotals(report),
        });
      }

      const { id } = await ctx.report.mailer.send(
        composeReportEmail(report, pdf),
      );
      ctx.audit.record({
        tool: 'send_daily_report',
        summary: `Emailed the report of ${report.today}`,
        details: { id, recipients: ctx.report.mailer.recipients.length },
      });
      return jsonResult({
        sent: true,
        email_id: id,
        pdf_bytes: pdf.length,
        totals: describeTotals(report),
      });
    },
  );
};
