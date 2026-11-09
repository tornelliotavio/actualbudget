import {
  capitalize,
  formatDay,
  formatLongDate,
  formatMoney,
  formatShare,
  plural,
} from './format';
import type { MailMessage } from './mailer';
import type { DailyReport, PendingBill } from './types';

const NEXT_BILLS_SHOWN = 6;

function billLine(bill: PendingBill): [string, string] {
  const share = bill.share === 1 ? '' : ` (${formatShare(bill.share)})`;
  return [
    `${formatDay(bill.dueDate)} ${bill.name}${share}`,
    `${bill.isEstimate ? '~ ' : ''}${formatMoney(bill.amount)}`,
  ];
}

function sumOf(bills: readonly PendingBill[]) {
  return bills.reduce((sum, bill) => sum + bill.amount, 0);
}

/** The reminders, most urgent first, as title and lines. */
function reminderBlocks({ reminders }: DailyReport) {
  return [
    { title: 'Vence hoje', bills: reminders.today },
    { title: 'Atrasado', bills: reminders.overdue },
    { title: 'Vence amanhã', bills: reminders.tomorrow },
  ]
    .filter(block => block.bills.length > 0)
    .map(block => ({
      title: `${block.title}: ${formatMoney(sumOf(block.bills))}`,
      lines: block.bills.map(billLine),
    }));
}

function subjectFor({ reminders, today, totals }: DailyReport) {
  const alerts = [
    reminders.today.length === 1
      ? `Vence hoje: ${reminders.today[0].name}, ${formatMoney(reminders.today[0].amount)}`
      : reminders.today.length > 1
        ? `Vencem hoje ${reminders.today.length} contas, ${formatMoney(sumOf(reminders.today))}`
        : null,
    reminders.overdue.length > 0
      ? plural(reminders.overdue.length, 'conta atrasada', 'contas atrasadas')
      : null,
  ].filter(Boolean);
  return alerts.length > 0
    ? `${alerts.join(' · ')} · Resumo ${formatDay(today)}`
    : `Resumo financeiro ${formatDay(today)}: falta pagar ${formatMoney(totals.toPay)}`;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function keyFigures({ totals }: DailyReport): [string, string][] {
  return [
    ['Recebido no mês', formatMoney(totals.received)],
    ['Gasto no mês', formatMoney(totals.spent)],
    ['Falta pagar (sua parte)', formatMoney(totals.toPay)],
    [
      totals.leftAfterBills < 0
        ? 'Falta depois das contas'
        : 'Sobra depois das contas',
      formatMoney(Math.abs(totals.leftAfterBills)),
    ],
    ...(totals.setAside > 0
      ? [
          ['Reservado nos cofrinhos', formatMoney(totals.setAside)] as [
            string,
            string,
          ],
        ]
      : []),
  ];
}

function htmlRow(label: string, value: string) {
  return `<tr><td style="padding:6px 16px 6px 0;color:#52514e">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`;
}

export function composeReportEmail(
  report: DailyReport,
  pdf: Buffer,
): MailMessage {
  const { notes, today } = report;
  const figures = keyFigures(report);
  const reminders = reminderBlocks(report);
  const reminded = new Set([
    ...report.reminders.overdue,
    ...report.reminders.today,
    ...report.reminders.tomorrow,
  ]);
  const bills = report.pendingBills
    .filter(bill => !reminded.has(bill))
    .slice(0, NEXT_BILLS_SHOWN)
    .map(billLine);
  const questionsLine =
    notes.questions.length > 0
      ? `${plural(notes.questions.length, 'item precisa', 'itens precisam')} da sua confirmação. Veja no PDF.`
      : null;
  const title = capitalize(formatLongDate(today));

  const text = [
    `Resumo financeiro. ${title}`,
    ...reminders.flatMap(block => [
      '',
      `${block.title}`,
      ...block.lines.map(([label, value]) => `${label}: ${value}`),
    ]),
    '',
    notes.summary ?? '',
    ...figures.map(([label, value]) => `${label}: ${value}`),
    ...(bills.length > 0 ? ['', 'Próximas contas:'] : []),
    ...bills.map(([label, value]) => `${label}: ${value}`),
    questionsLine ?? '',
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');

  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#14171f;font-size:14px;line-height:1.5;max-width:520px">',
    '<h1 style="font-size:20px;margin:0 0 2px">Resumo financeiro</h1>',
    `<p style="margin:0 0 16px;color:#52514e">${escapeHtml(title)}</p>`,
    ...reminders.map(
      block =>
        `<div style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #d03b3b;background:#fdf3f2"><h2 style="font-size:15px;margin:0 0 4px">${escapeHtml(block.title)}</h2><table style="border-collapse:collapse;width:100%">${block.lines.map(([label, value]) => htmlRow(label, value)).join('')}</table></div>`,
    ),
    notes.summary
      ? `<p style="margin:0 0 16px">${escapeHtml(notes.summary)}</p>`
      : '',
    `<table style="border-collapse:collapse;width:100%;margin:0 0 16px">${figures.map(([label, value]) => htmlRow(label, value)).join('')}</table>`,
    bills.length > 0
      ? `<h2 style="font-size:14px;margin:0 0 4px">Próximas contas</h2><table style="border-collapse:collapse;width:100%;margin:0 0 16px">${bills.map(([label, value]) => htmlRow(label, value)).join('')}</table>`
      : '',
    questionsLine
      ? `<p style="margin:0 0 16px;font-weight:600">${escapeHtml(questionsLine)}</p>`
      : '',
    '<p style="margin:0;color:#6f6e69;font-size:12px">O relatório completo está no PDF em anexo.</p>',
    '</div>',
  ].join('');

  return {
    subject: subjectFor(report),
    html,
    text,
    attachments: [{ filename: `resumo-financeiro-${today}.pdf`, content: pdf }],
  };
}
