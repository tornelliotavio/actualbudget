import { installmentFrom } from '#server/credit-cards/engine/installments';
import { addDays } from '#shared/months';

import {
  allLines,
  findCell,
  includesText,
  lastFourDigits,
  lineText,
  parseAmount,
  parseDate,
  required,
  valueAfter,
  valueUnderLabel,
} from './text';
import type {
  CardStatement,
  StatementEntry,
  StatementLine,
  StatementParser,
  StatementText,
} from './types';

const ENTRY_START = /^(\d{2}\/\d{2}\/\d{2})(?:\s+\d{3})?$/;
const INSTALLMENT = /^(\d{1,2})\/(\d{1,2})$/;

function startsWith(prefix: string) {
  return (text: string) => text.startsWith(prefix);
}

function isEndOfEntries(text: string) {
  return (
    text === 'Encargos' ||
    text.startsWith('Continue acumulando') ||
    text.includes('Taxa de Juros')
  );
}

type Columns = { purchaseTotalFrom: number; installmentFrom: number };

/**
 * The entries header spans three lines; the one naming `Loja` holds the
 * purchase total column (`Valor`), the one below the installment column.
 */
function readColumns(lines: StatementLine[], from: number): Columns | null {
  const header = lines.slice(from, from + 6);
  const value = header
    .map(line => findCell(line, text => text === 'Valor'))
    .filter(cell => cell != null)
    .sort((a, b) => b.x - a.x)[0];
  const number = header
    .map(line => findCell(line, text => text === 'Nº' || text === 'parc.'))
    .find(cell => cell != null);
  if (!value || !number) {
    return null;
  }
  return {
    purchaseTotalFrom: value.x - 20,
    installmentFrom: (value.x + number.x) / 2,
  };
}

function readEntries(lines: StatementLine[]): StatementEntry[] {
  const start = lines.findIndex(line =>
    lineText(line).startsWith('Histórico de Despesas'),
  );
  const columns = start < 0 ? null : readColumns(lines, start + 1);
  if (!columns) {
    return [];
  }

  const entries: StatementEntry[] = [];
  for (const line of lines.slice(start + 1)) {
    const text = lineText(line);
    if (isEndOfEntries(text)) {
      break;
    }
    const [first, ...rest] = line.cells;
    const match = first ? ENTRY_START.exec(first.text) : null;
    const date = match ? parseDate(match[1], { shortYears: true }) : null;
    if (!date) {
      // Cardholder names and subtotals sit between the entries.
      continue;
    }
    const description = rest
      .filter(cell => cell.x < columns.purchaseTotalFrom)
      .map(cell => cell.text)
      .join(' ');
    const purchaseTotal = rest
      .filter(
        cell =>
          cell.x >= columns.purchaseTotalFrom &&
          cell.x < columns.installmentFrom,
      )
      .map(cell => parseAmount(cell.text))
      .find(amount => amount != null);
    const installmentCell = rest.find(
      cell => cell.x >= columns.installmentFrom && INSTALLMENT.test(cell.text),
    );
    const installmentMatch = installmentCell
      ? INSTALLMENT.exec(installmentCell.text)
      : null;
    const printed = rest
      .filter(cell => cell !== installmentCell)
      .filter(cell => cell.x >= columns.installmentFrom)
      .map(cell => parseAmount(cell.text))
      .find(amount => amount != null);
    if (printed == null) {
      continue;
    }
    entries.push({
      date,
      description,
      merchant: null,
      amount: -printed,
      installment: installmentMatch
        ? installmentFrom(
            Number(installmentMatch[1]),
            Number(installmentMatch[2]),
          )
        : null,
      purchaseTotal: purchaseTotal == null ? null : -purchaseTotal,
      isPayment: printed < 0 && /PAGAMENTO/i.test(description),
    });
  }
  return entries;
}

function readClosingDate(lines: StatementLine[]) {
  for (const line of lines) {
    const match = /compras em (\d{2}\/\d{2}\/\d{4})/.exec(lineText(line));
    if (match) {
      return parseDate(match[1]);
    }
  }
  // The best day to buy is the first day of the next cycle.
  const bestDay = valueUnderLabel(lines, startsWith('Melhor data'), text =>
    parseDate(text),
  );
  return bestDay ? addDays(bestDay, -1) : null;
}

function readLimit(lines: StatementLine[], label: string) {
  for (const line of lines) {
    const value = valueAfter(line, text => text === label, parseAmount);
    if (value != null) {
      return value;
    }
  }
  return null;
}

function parse(text: StatementText): CardStatement {
  const lines = allLines(text);
  const cardLine = lines.find(line => findCell(line, startsWith('Cartão:')));
  const cardLast4 = cardLine ? lastFourDigits(lineText(cardLine)) : null;

  return {
    issuer: 'riachuelo',
    cardLast4,
    closingDate: required(readClosingDate(lines), 'closing date'),
    dueDate: required(
      valueUnderLabel(lines, startsWith('Vencimento'), text => parseDate(text)),
      'due date',
    ),
    total: required(
      valueUnderLabel(lines, startsWith('Saldo à Pagar'), parseAmount),
      'total',
    ),
    minimumPayment: null,
    creditLimit: readLimit(lines, 'Total'),
    availableLimit: readLimit(lines, 'Disponivel'),
    entries: readEntries(lines),
  };
}

export const riachueloParser: StatementParser = {
  issuer: 'riachuelo',
  name: 'Riachuelo',
  detect: text =>
    includesText(text, 'MIDWAY') && includesText(text, 'Riachuelo'),
  parse,
};
