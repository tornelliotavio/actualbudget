import { createRequire } from 'module';

import PDFDocument from 'pdfkit';

import {
  BILL_STATUS_LABELS,
  capitalize,
  daysUntil,
  formatDay,
  formatLongDate,
  formatMoney,
  formatMonth,
  formatShortMonth,
  plural,
} from './format';
import type {
  DailyReport,
  PendingBill,
  ReportBillStatus,
  ReportCard,
  SpendingLine,
} from './types';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = PAGE_HEIGHT - 52;
const ROW_HEIGHT = 21;
const CELL_GUTTER = 12;

const INK = '#14171f';
const SECONDARY = '#52514e';
const MUTED = '#6f6e69';
const RULE = '#e4e3df';
const PANEL = '#f5f4f1';
const BAR = '#2a78d6';
const BAR_TRACK = '#dbe8f8';
const CRITICAL = '#d03b3b';
const SERIOUS = '#ec835a';
const WARNING = '#fab219';
const GOOD = '#0ca30c';

const STATUS_DOTS: Record<ReportBillStatus, string> = {
  overdue: CRITICAL,
  due: SERIOUS,
  upcoming: WARNING,
  open: BAR,
  scheduled: MUTED,
};

const CARD_STATUS_LABELS: Record<string, string> = {
  overdue: 'Atrasada',
  partially_paid: 'Paga em parte',
  closed: 'Fechada',
  open: 'Aberta',
  upcoming: 'Futura',
  paid: 'Paga',
};

const CARD_STATUS_DOTS: Record<string, string> = {
  overdue: CRITICAL,
  partially_paid: SERIOUS,
  closed: WARNING,
  open: BAR,
  upcoming: MUTED,
  paid: GOOD,
};

type FontName = 'regular' | 'medium' | 'semibold' | 'bold';
type FontFeature = NonNullable<PDFKit.Mixins.TextOptions['features']>[number];
type Align = 'left' | 'right';
type Style = {
  font?: FontName;
  size?: number;
  color?: string;
  align?: Align;
  tabular?: boolean;
};

type Column = { width: number; align?: Align };
type Cell =
  | string
  | { text: string; style?: Style; dot?: string }
  | { meter: { used: number; total: number } };

const FONT_FILES: Record<FontName, string> = {
  regular: 'inter-latin-400-normal.woff',
  medium: 'inter-latin-500-normal.woff',
  semibold: 'inter-latin-600-normal.woff',
  bold: 'inter-latin-700-normal.woff',
};

/** The embedded subset covers Latin; anything else would print as a box. */
function printable(text: string) {
  return text
    .replace(/[^ -ÿ–—‘’“”•…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createCanvas(doc: PDFKit.PDFDocument) {
  let y = MARGIN;

  function apply({ font = 'regular', size = 9.5, color = INK }: Style) {
    doc.font(font).fontSize(size).fillColor(color);
  }

  function fit(text: string, width: number, features: FontFeature[]) {
    if (doc.widthOfString(text, { features }) <= width) return text;
    let kept = text;
    while (kept && doc.widthOfString(`${kept}…`, { features }) > width) {
      kept = kept.slice(0, -1);
    }
    return `${kept.trimEnd()}…`;
  }

  /** Placed by hand: pdfkit wraps any text it's given a width for. */
  function line(
    text: string,
    x: number,
    top: number,
    width: number,
    style: Style,
  ) {
    apply(style);
    const features: FontFeature[] = style.tabular ? ['tnum'] : [];
    const fitted = fit(printable(text), width, features);
    const left =
      style.align === 'right'
        ? x + width - doc.widthOfString(fitted, { features })
        : x;
    doc.text(fitted, left, top, { lineBreak: false, features });
  }

  function paragraph(text: string, x: number, width: number, style: Style) {
    apply(style);
    const clean = printable(text);
    const height = doc.heightOfString(clean, { width, lineGap: 2.5 });
    ensure(height + 4);
    apply(style);
    doc.text(clean, x, y, { width, lineGap: 2.5 });
    y += height;
  }

  function ensure(height: number) {
    if (y + height <= CONTENT_BOTTOM) return false;
    doc.addPage();
    y = MARGIN;
    return true;
  }

  function rule(top: number, color = RULE, weight = 0.6) {
    doc
      .moveTo(MARGIN, top)
      .lineTo(PAGE_WIDTH - MARGIN, top)
      .lineWidth(weight)
      .strokeColor(color)
      .stroke();
  }

  /** Rounded at the data end, square at the baseline. */
  function bar(
    x: number,
    top: number,
    width: number,
    height: number,
    color: string,
  ) {
    const radius = Math.min(3, width, height / 2);
    doc
      .moveTo(x, top)
      .lineTo(x + width - radius, top)
      .quadraticCurveTo(x + width, top, x + width, top + radius)
      .lineTo(x + width, top + height - radius)
      .quadraticCurveTo(
        x + width,
        top + height,
        x + width - radius,
        top + height,
      )
      .lineTo(x, top + height)
      .closePath()
      .fill(color);
  }

  function meter(x: number, top: number, width: number, share: number) {
    const color = share >= 0.9 ? CRITICAL : share >= 0.7 ? WARNING : BAR;
    doc.roundedRect(x, top, width, 5, 2.5).fill(BAR_TRACK);
    if (share > 0) {
      doc
        .roundedRect(x, top, Math.max(5, width * Math.min(share, 1)), 5, 2.5)
        .fill(color);
    }
  }

  /** `keep` is how much of the section must fit under its title. */
  function section(title: string, subtitle?: string, keep = 40) {
    ensure(54 + keep);
    if (y > MARGIN) y += 20;
    line(title, MARGIN, y, CONTENT_WIDTH, { font: 'semibold', size: 13 });
    y += 19;
    if (subtitle) {
      line(subtitle, MARGIN, y, CONTENT_WIDTH, { size: 8.5, color: MUTED });
      y += 15;
    }
  }

  function drawCell(
    cell: Cell,
    x: number,
    top: number,
    column: Column,
    style: Style,
  ) {
    const width = column.width - CELL_GUTTER;
    if (typeof cell === 'string') {
      line(cell, x, top + 6, width, { ...style, align: column.align });
      return;
    }
    if ('meter' in cell) {
      const { used, total } = cell.meter;
      const share = total > 0 ? used / total : 0;
      const trackWidth = column.width - 30;
      meter(x, top + 8.5, trackWidth, share);
      line(`${Math.round(share * 100)}%`, x + trackWidth + 4, top + 6, 26, {
        size: 8.5,
        color: SECONDARY,
        align: 'right',
        tabular: true,
      });
      return;
    }
    const offset = cell.dot ? 10 : 0;
    if (cell.dot) doc.circle(x + 3, top + 10.5, 3).fill(cell.dot);
    line(cell.text, x + offset, top + 6, width - offset, {
      ...style,
      ...cell.style,
      align: column.align,
    });
  }

  function row(
    columns: readonly Column[],
    cells: readonly Cell[],
    style: Style = {},
  ) {
    let x = MARGIN;
    cells.forEach((cell, index) => {
      const column = columns[index];
      const isLast = index === columns.length - 1;
      const cellX = column.align === 'right' && isLast ? x + CELL_GUTTER : x;
      drawCell(cell, cellX, y, column, {
        tabular: column.align === 'right',
        ...style,
      });
      x += column.width;
    });
    y += ROW_HEIGHT;
  }

  function table(
    columns: readonly Column[],
    header: readonly string[],
    rows: readonly (readonly Cell[])[],
  ) {
    const drawHeader = () => {
      row(columns, header, {
        size: 8,
        color: MUTED,
        font: 'medium',
        tabular: false,
      });
      rule(y - 2, '#cfcdc7', 0.7);
    };
    drawHeader();
    for (const cells of rows) {
      if (ensure(ROW_HEIGHT)) drawHeader();
      row(columns, cells);
      rule(y - 0.5);
    }
  }

  return {
    doc,
    line,
    paragraph,
    ensure,
    rule,
    bar,
    section,
    row,
    table,
    get y() {
      return y;
    },
    set y(value: number) {
      y = value;
    },
  };
}

type Canvas = ReturnType<typeof createCanvas>;

function drawHeader(canvas: Canvas, report: DailyReport) {
  const monthName = formatMonth(report.month);
  canvas.line('Resumo financeiro', MARGIN, canvas.y, 300, {
    font: 'bold',
    size: 23,
  });
  canvas.line(`Mês de ${monthName}`, MARGIN, canvas.y + 3, CONTENT_WIDTH, {
    size: 9,
    color: MUTED,
    align: 'right',
  });
  canvas.y += 30;
  canvas.line(
    capitalize(formatLongDate(report.today)),
    MARGIN,
    canvas.y,
    CONTENT_WIDTH,
    {
      size: 10,
      color: SECONDARY,
    },
  );
  canvas.y += 20;
  if (report.notes.summary) {
    canvas.paragraph(report.notes.summary, MARGIN, CONTENT_WIDTH, {
      size: 10.5,
      color: INK,
    });
    canvas.y += 10;
  }
}

function drawTile(
  canvas: Canvas,
  x: number,
  width: number,
  { label, value, note }: { label: string; value: string; note: string },
) {
  const top = canvas.y;
  const pad = 11;
  canvas.doc.roundedRect(x, top, width, 68, 6).fill(PANEL);
  canvas.line(label, x + pad, top + 10, width - pad * 2, {
    size: 8.5,
    font: 'medium',
    color: SECONDARY,
  });
  canvas.line(value, x + pad, top + 26, width - pad * 2, {
    size: value.length > 13 ? 12.5 : 14,
    font: 'semibold',
  });
  canvas.line(note, x + pad, top + 49, width - pad * 2, {
    size: 7.8,
    color: MUTED,
  });
}

function drawTiles(canvas: Canvas, report: DailyReport) {
  const { totals } = report;
  const previous = capitalize(formatShortMonth(report.previousMonth));
  const gap = 9;
  const width = (CONTENT_WIDTH - gap * 3) / 4;
  const isShort = totals.leftAfterBills < 0;
  const tiles = [
    {
      label: 'Recebido no mês',
      value: formatMoney(totals.received),
      note: `${previous}: ${formatMoney(totals.previousReceived)}`,
    },
    {
      label: 'Gasto no mês',
      value: formatMoney(totals.spent),
      note: `${previous}: ${formatMoney(totals.previousSpent)}`,
    },
    {
      label: 'Falta pagar',
      value: formatMoney(totals.toPay),
      note:
        totals.overdueCount > 0
          ? plural(totals.overdueCount, 'atrasada', 'atrasadas')
          : `Pago: ${formatMoney(totals.paid)}`,
    },
    {
      label: isShort ? 'Falta depois das contas' : 'Sobra depois das contas',
      value: formatMoney(Math.abs(totals.leftAfterBills)),
      note: `Em conta: ${formatMoney(totals.cash)}`,
    },
  ];
  tiles.forEach((tile, index) => {
    drawTile(canvas, MARGIN + index * (width + gap), width, tile);
  });
  canvas.y += 68;
}

function billStatusLabel(bill: PendingBill, today: string) {
  if (bill.status === 'upcoming' || bill.status === 'scheduled') {
    const days = daysUntil(today, bill.dueDate);
    return days === 1 ? 'Vence amanhã' : `Em ${days} dias`;
  }
  if (bill.status === 'overdue') {
    return bill.kind === 'card' ? 'Atrasada' : 'Atrasado';
  }
  return BILL_STATUS_LABELS[bill.status];
}

function drawPendingBills(canvas: Canvas, report: DailyReport) {
  const { pendingBills, totals } = report;
  canvas.section(
    `Falta pagar em ${formatMonth(report.month)}`,
    'Faturas e contas agendadas ainda sem pagamento, incluindo as atrasadas.',
  );
  if (pendingBills.length === 0) {
    canvas.paragraph('Tudo pago neste mês.', MARGIN, CONTENT_WIDTH, {
      color: SECONDARY,
    });
    return;
  }
  const columns: Column[] = [
    { width: 48 },
    { width: 275 },
    { width: 92 },
    { width: 92.28, align: 'right' },
  ];
  canvas.table(
    columns,
    ['Vence', 'Conta', 'Situação', 'Valor'],
    pendingBills.map(bill => [
      formatDay(bill.dueDate),
      bill.name,
      {
        text: billStatusLabel(bill, report.today),
        dot: STATUS_DOTS[bill.status],
      },
      `${bill.isEstimate ? '~ ' : ''}${formatMoney(bill.amount)}`,
    ]),
  );
  canvas.ensure(ROW_HEIGHT);
  canvas.row(columns, ['', 'Total', '', formatMoney(totals.toPay)], {
    font: 'semibold',
  });
  if (pendingBills.some(bill => bill.isEstimate)) {
    canvas.line(
      '~ valor estimado pelo agendamento.',
      MARGIN,
      canvas.y + 2,
      CONTENT_WIDTH,
      {
        size: 8,
        color: MUTED,
      },
    );
    canvas.y += 12;
  }
}

function cardCells(card: ReportCard): Cell[] {
  return [
    card.name.replace(/^Cartão\s+/i, ''),
    formatDay(card.dueDate),
    {
      text: CARD_STATUS_LABELS[card.status] ?? card.status,
      dot: CARD_STATUS_DOTS[card.status] ?? MUTED,
    },
    formatMoney(card.total),
    formatMoney(card.paid),
    { text: formatMoney(card.due), style: { font: 'semibold' } },
    card.limitTotal
      ? { meter: { used: card.limitUsed ?? 0, total: card.limitTotal } }
      : '—',
  ];
}

function drawCards(canvas: Canvas, report: DailyReport) {
  if (report.cards.length === 0) return;
  canvas.section(
    'Faturas dos cartões',
    'A fatura em que cada cartão está agora.',
  );
  canvas.table(
    [
      { width: 92 },
      { width: 42 },
      { width: 76 },
      { width: 80, align: 'right' },
      { width: 80, align: 'right' },
      { width: 80, align: 'right' },
      { width: 57.28 },
    ],
    ['Cartão', 'Vence', 'Situação', 'Total', 'Pago', 'Falta', 'Limite'],
    report.cards.map(cardCells),
  );
  if (report.dueByMonth.length > 0) {
    const months = report.dueByMonth
      .map(
        ({ month, amount }) =>
          `${formatShortMonth(month)} ${formatMoney(amount)}`,
      )
      .join(' · ');
    canvas.y += 5;
    canvas.line(`Total por mês: ${months}`, MARGIN, canvas.y, CONTENT_WIDTH, {
      size: 8.5,
      color: SECONDARY,
      tabular: true,
    });
    canvas.y += 12;
  }
}

/** Money back in a category shows as a credit, not as negative spending. */
function formatSpent(amount: number) {
  return amount < 0 ? `+ ${formatMoney(-amount)}` : formatMoney(amount);
}

function drawSpendingRow(
  canvas: Canvas,
  entry: SpendingLine,
  scale: number,
  { isGroup }: { isGroup: boolean },
) {
  const labelWidth = 170;
  const barX = MARGIN + labelWidth;
  const barWidth = 170;
  const amountX = barX + barWidth;
  const amountWidth = 84;
  const previousWidth = CONTENT_WIDTH - labelWidth - barWidth - amountWidth;
  const font: FontName = isGroup ? 'semibold' : 'regular';
  const top = canvas.y + 5;

  canvas.line(entry.name, MARGIN + (isGroup ? 0 : 10), top, labelWidth - 14, {
    font,
    size: isGroup ? 9.5 : 9,
    color: isGroup ? INK : SECONDARY,
  });
  if (!isGroup && entry.total > 0) {
    canvas.bar(
      barX,
      top + 2.5,
      Math.max(1.5, (entry.total / scale) * barWidth),
      7,
      BAR,
    );
  }
  canvas.line(formatSpent(entry.total), amountX, top, amountWidth, {
    font,
    size: 9,
    align: 'right',
    tabular: true,
  });
  canvas.line(
    formatSpent(entry.previous),
    amountX + amountWidth,
    top,
    previousWidth,
    {
      size: 8.5,
      color: MUTED,
      align: 'right',
      tabular: true,
    },
  );
  canvas.y += isGroup ? 20 : 17.5;
}

function drawSpending(canvas: Canvas, report: DailyReport) {
  const { spending, totals } = report;
  canvas.section(
    'Gastos por categoria',
    `Pelo mês da fatura, como no Painel, com as parcelas já previstas. Total: ${formatMoney(totals.spent)}.`,
    120,
  );
  if (spending.length === 0) {
    canvas.paragraph(
      'Nenhum gasto neste mês até agora.',
      MARGIN,
      CONTENT_WIDTH,
      {
        color: SECONDARY,
      },
    );
    return;
  }
  const scale = Math.max(
    1,
    ...spending.flatMap(group => [
      ...(group.categories.length === 0 ? [group.total] : []),
      ...group.categories.map(category => category.total),
    ]),
  );
  const drawColumns = () => {
    const style = { size: 8, font: 'medium' as const, color: MUTED };
    canvas.line(
      capitalize(formatMonth(report.month)),
      MARGIN + 340,
      canvas.y,
      84,
      {
        ...style,
        align: 'right',
      },
    );
    canvas.line(
      capitalize(formatMonth(report.previousMonth)),
      MARGIN + 424,
      canvas.y,
      CONTENT_WIDTH - 424,
      { ...style, align: 'right' },
    );
    canvas.y += 13;
    canvas.rule(canvas.y, '#cfcdc7', 0.7);
    canvas.y += 2;
  };
  drawColumns();
  for (const group of spending) {
    if (canvas.ensure(40)) drawColumns();
    drawSpendingRow(canvas, group, scale, { isGroup: true });
    for (const category of group.categories) {
      if (canvas.ensure(18)) drawColumns();
      drawSpendingRow(canvas, category, scale, { isGroup: false });
    }
    canvas.rule(canvas.y + 1);
    canvas.y += 3;
  }
}

function drawIncome(canvas: Canvas, report: DailyReport) {
  const { income, receipts, otherReceipts, totals } = report;
  canvas.section(
    'O que já recebi',
    `Entradas de 01/${report.month.slice(5, 7)} a ${formatDay(report.today)}, sem contar transferências entre suas contas.`,
  );
  const parts = [
    `Receitas ${formatMoney(totals.received)}`,
    `Reembolsos e repasses ${formatMoney(totals.credits)}`,
    ...(totals.uncategorizedInflow > 0
      ? [`Sem categoria ${formatMoney(totals.uncategorizedInflow)}`]
      : []),
  ];
  canvas.line(parts.join(' · '), MARGIN, canvas.y, CONTENT_WIDTH, {
    size: 9,
    color: SECONDARY,
    tabular: true,
  });
  canvas.y += 16;
  if (income.length > 0) {
    const previous = capitalize(formatMonth(report.previousMonth));
    canvas.table(
      [
        { width: 323 },
        { width: 92, align: 'right' },
        { width: 92.28, align: 'right' },
      ],
      ['Receita', 'No mês', previous],
      income.map(line => [
        line.name,
        { text: formatMoney(line.total), style: { font: 'semibold' } },
        { text: formatMoney(line.previous), style: { color: MUTED } },
      ]),
    );
    canvas.y += 8;
  }
  if (receipts.length === 0) {
    canvas.paragraph(
      'Nenhuma entrada neste mês até agora.',
      MARGIN,
      CONTENT_WIDTH,
      {
        color: SECONDARY,
      },
    );
    return;
  }
  const columns: Column[] = [
    { width: 44 },
    { width: 211 },
    { width: 160 },
    { width: 92.28, align: 'right' },
  ];
  canvas.table(
    columns,
    ['Data', 'De', 'Categoria', 'Valor'],
    receipts.map(receipt => [
      formatDay(receipt.date),
      receipt.label,
      receipt.category
        ? receipt.category
        : { text: 'Sem categoria', dot: SERIOUS, style: { color: SECONDARY } },
      formatMoney(receipt.amount),
    ]),
  );
  if (otherReceipts.count > 0) {
    canvas.ensure(ROW_HEIGHT);
    canvas.row(
      columns,
      [
        '',
        `Mais ${plural(otherReceipts.count, 'entrada menor', 'entradas menores')}`,
        '',
        formatMoney(otherReceipts.amount),
      ],
      { color: SECONDARY },
    );
  }
}

function drawAccounts(canvas: Canvas, report: DailyReport) {
  canvas.section(
    'Saldo das contas',
    'Comparado com o que o banco informou na última sincronização.',
    (report.accounts.length + 1) * ROW_HEIGHT,
  );
  canvas.table(
    [
      { width: 197 },
      { width: 100, align: 'right' },
      { width: 100, align: 'right' },
      { width: 110.28 },
    ],
    ['Conta', 'No Actual', 'No banco', 'Conferência'],
    report.accounts.map(account => {
      const isLinked = account.bankReported != null;
      const matches = account.bankDifference === 0;
      return [
        account.name,
        formatMoney(account.balance),
        isLinked ? formatMoney(account.bankReported ?? 0) : '—',
        !isLinked
          ? { text: 'Sem banco', style: { color: MUTED } }
          : matches
            ? { text: 'Confere', dot: GOOD }
            : {
                text: `Difere ${formatMoney(Math.abs(account.bankDifference))}`,
                dot: CRITICAL,
              },
      ];
    }),
  );
}

function drawList(canvas: Canvas, items: readonly string[]) {
  for (const item of items) {
    canvas.ensure(18);
    const top = canvas.y;
    canvas.doc.circle(MARGIN + 2.5, top + 5.5, 1.6).fill(MUTED);
    canvas.paragraph(item, MARGIN + 12, CONTENT_WIDTH - 12, { size: 9.5 });
    canvas.y += 6;
  }
}

function drawNotes(
  canvas: Canvas,
  { corrections, questions }: DailyReport['notes'],
) {
  if (corrections.length > 0) {
    canvas.section('O que corrigi hoje');
    drawList(
      canvas,
      corrections.map(({ description, count }) =>
        count ? `${description} (${count})` : description,
      ),
    );
  }
  if (questions.length > 0) {
    canvas.section('Preciso da sua confirmação', undefined, 30);
    drawList(
      canvas,
      questions.map(({ description, date, amount }) =>
        [
          date ? formatDay(date) : null,
          amount != null ? formatMoney(Math.round(amount * 100)) : null,
          description,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    );
  }
}

function drawFooters(canvas: Canvas, report: DailyReport) {
  const { doc } = canvas;
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index);
    const top = PAGE_HEIGHT - 34;
    canvas.line(
      `Actual · ${formatDay(report.today)}/${report.today.slice(0, 4)}`,
      MARGIN,
      top,
      300,
      {
        size: 7.5,
        color: MUTED,
      },
    );
    canvas.line(
      `Página ${index + 1} de ${range.count}`,
      MARGIN,
      top,
      CONTENT_WIDTH,
      {
        size: 7.5,
        color: MUTED,
        align: 'right',
      },
    );
  }
}

/** Renders the daily report as an A4 PDF. */
export function renderReportPdf(report: DailyReport): Promise<Buffer> {
  const require = createRequire(import.meta.url);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    lang: 'pt-BR',
    displayTitle: true,
    info: {
      Title: `Resumo financeiro ${formatDay(report.today)}`,
      Author: 'Actual',
    },
  });
  for (const [name, file] of Object.entries(FONT_FILES)) {
    doc.registerFont(name, require.resolve(`@fontsource/inter/files/${file}`));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const canvas = createCanvas(doc);
    drawHeader(canvas, report);
    drawTiles(canvas, report);
    drawPendingBills(canvas, report);
    drawCards(canvas, report);
    drawSpending(canvas, report);
    drawIncome(canvas, report);
    drawAccounts(canvas, report);
    drawNotes(canvas, report.notes);
    drawFooters(canvas, report);
    doc.end();
  });
}
