import { parseInstallmentLabel } from '#server/credit-cards/engine/installments';

import {
  allLines,
  findCell,
  includesText,
  lastFourDigits,
  lineText,
  parseAmount,
  parseDate,
  required,
  valueUnderLabel,
} from './text';
import type {
  CardStatement,
  StatementEntry,
  StatementLine,
  StatementParser,
  StatementText,
} from './types';

const END_OF_ENTRIES = [
  'Compras parceladas',
  'Próxima Fatura',
  'Confira as informações',
  'Limites em R$',
];

function startsWith(prefix: string) {
  return (text: string) => text.startsWith(prefix);
}

type Columns = { merchantFrom: number; amountFrom: number };

function readColumns(header: StatementLine): Columns {
  const description = required(
    findCell(header, startsWith('Descrição')),
    'entries header',
  );
  const merchant = required(
    findCell(header, startsWith('Estabelecimento')),
    'entries header',
  );
  const amount = required(
    findCell(header, startsWith('Crédito')),
    'entries header',
  );
  return {
    merchantFrom: (description.x + merchant.x) / 2,
    amountFrom: (merchant.x + amount.x) / 2,
  };
}

function readEntries(lines: StatementLine[]): StatementEntry[] {
  const start = lines.findIndex(line =>
    lineText(line).startsWith('Lançamentos detalhados'),
  );
  const headerIndex = lines.findIndex(
    (line, index) =>
      index > start && findCell(line, startsWith('Estabelecimento')),
  );
  if (start < 0 || headerIndex < 0) {
    return [];
  }
  const columns = readColumns(lines[headerIndex]);

  const entries: StatementEntry[] = [];
  let current: StatementEntry | null = null;
  for (const line of lines.slice(headerIndex + 1)) {
    const text = lineText(line);
    if (END_OF_ENTRIES.some(marker => text.startsWith(marker))) {
      break;
    }
    // Each cardholder's entries come under a heading of their own.
    if (/TRANSA[ÇC][ÕO]ES REALIZADAS/i.test(text)) {
      current = null;
      continue;
    }
    const [first, ...rest] = line.cells;
    const date = first ? parseDate(first.text) : null;
    if (!date) {
      // A description that wraps continues on the lines below.
      const wrapped = line.cells
        .filter(cell => cell.x < columns.merchantFrom)
        .map(cell => cell.text)
        .join(' ');
      if (current && wrapped) {
        current.description = [current.description, wrapped]
          .filter(Boolean)
          .join(' ');
      }
      continue;
    }

    const description = rest
      .filter(cell => cell.x < columns.merchantFrom)
      .map(cell => cell.text)
      .join(' ');
    const merchant = rest
      .filter(
        cell => cell.x >= columns.merchantFrom && cell.x < columns.amountFrom,
      )
      .map(cell => cell.text)
      .join(' ');
    const printed = rest
      .filter(cell => cell.x >= columns.amountFrom)
      .map(cell => parseAmount(cell.text))
      .find(amount => amount != null);
    if (printed == null) {
      current = null;
      continue;
    }
    current = {
      date,
      description,
      merchant: merchant || null,
      amount: -printed,
      installment: parseInstallmentLabel(description),
      purchaseTotal: null,
      isPayment: printed < 0 && /PAGAMENTO/i.test(description),
    };
    entries.push(current);
  }
  return entries;
}

function readLimits(lines: StatementLine[]) {
  // `Compras  10.000,00  2.712,25  7.287,75`: total, used, available.
  const row = lines.find(
    line =>
      line.cells[0]?.text === 'Compras' &&
      line.cells.filter(cell => parseAmount(cell.text) != null).length === 3,
  );
  const amounts =
    row?.cells
      .map(cell => parseAmount(cell.text))
      .filter(amount => amount != null) ?? [];
  return {
    creditLimit: amounts[0] ?? null,
    availableLimit: amounts[2] ?? null,
  };
}

function parse(text: StatementText): CardStatement {
  const lines = allLines(text);

  const cardIndex = lines.findIndex(line =>
    lineText(line).startsWith('Número do Cartão'),
  );
  const cardLast4 =
    cardIndex >= 0 && lines[cardIndex + 1]
      ? lastFourDigits(lineText(lines[cardIndex + 1]))
      : null;

  const total = valueUnderLabel(
    lines,
    startsWith('Pagamento Total'),
    parseAmount,
  );
  const dueDate = valueUnderLabel(
    lines,
    startsWith('Data de Vencimento'),
    text => parseDate(text),
  );
  const minimumPayment = valueUnderLabel(
    lines,
    startsWith('Mínimo'),
    parseAmount,
  );
  // The bill closes on the day its document is issued.
  const closingDate = valueUnderLabel(
    lines,
    startsWith('Data Documento'),
    text => parseDate(text),
  );

  return {
    issuer: 'renner',
    cardLast4,
    closingDate: required(closingDate, 'closing date'),
    dueDate: required(dueDate, 'due date'),
    total: required(total, 'total'),
    minimumPayment,
    ...readLimits(lines),
    entries: readEntries(lines),
  };
}

export const rennerParser: StatementParser = {
  issuer: 'renner',
  name: 'Renner',
  detect: text =>
    includesText(text, 'Realize Sociedade de Crédito') ||
    includesText(text, 'Cartões Renner'),
  parse,
};
