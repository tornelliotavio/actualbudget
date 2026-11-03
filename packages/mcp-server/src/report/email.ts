import {
  capitalize,
  formatDay,
  formatLongDate,
  formatMoney,
  plural,
} from './format';
import type { MailMessage } from './mailer';
import type { DailyReport } from './types';

const NEXT_BILLS_SHOWN = 6;

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
    ['Falta pagar', formatMoney(totals.toPay)],
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
  const { totals, notes, today } = report;
  const figures = keyFigures(report);
  const bills = report.pendingBills
    .slice(0, NEXT_BILLS_SHOWN)
    .map(
      bill =>
        [
          `${formatDay(bill.dueDate)} ${bill.name}`,
          formatMoney(bill.amount),
        ] as [string, string],
    );
  const questionsLine =
    notes.questions.length > 0
      ? `${plural(notes.questions.length, 'item precisa', 'itens precisam')} da sua confirmação. Veja no PDF.`
      : null;
  const title = capitalize(formatLongDate(today));

  const text = [
    `Resumo financeiro. ${title}`,
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
    subject: `Resumo financeiro ${formatDay(today)}: falta pagar ${formatMoney(totals.toPay)}`,
    html,
    text,
    attachments: [{ filename: `resumo-financeiro-${today}.pdf`, content: pdf }],
  };
}
