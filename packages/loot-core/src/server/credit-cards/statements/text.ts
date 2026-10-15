import type { Cents, DateString } from '#server/credit-cards/engine/types';

import type { StatementCell, StatementLine, StatementText } from './types';
import { StatementParseError } from './types';

/** How far a value may sit from its label's left edge and still be its value. */
const COLUMN_TOLERANCE = 40;

const AMOUNT =
  /^([+-])?\s*(?:R\$\s*)?([+-])?\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/;
const FULL_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const SHORT_DATE = /^(\d{2})\/(\d{2})\/(\d{2})$/;

export function lineText(line: StatementLine) {
  return line.cells.map(cell => cell.text).join(' ');
}

export function allLines(text: StatementText): StatementLine[] {
  return text.pages.flat();
}

export function includesText(text: StatementText, needle: string) {
  const lower = needle.toLowerCase();
  return allLines(text).some(line =>
    lineText(line).toLowerCase().includes(lower),
  );
}

/** `1.912,25`, `R$ 1.567,19`, `- 1.320,64` or `+ 2,61`, as printed. */
export function parseAmount(value: string): Cents | null {
  const match = AMOUNT.exec(value.trim());
  if (!match) {
    return null;
  }
  const sign = (match[1] ?? match[2]) === '-' ? -1 : 1;
  const cents = Number(match[3].replace(/\./g, '')) * 100 + Number(match[4]);
  return sign * cents;
}

/** `13/10/2026`, or `14/10/26` when `shortYears` is set. */
export function parseDate(
  value: string,
  { shortYears = false }: { shortYears?: boolean } = {},
): DateString | null {
  const trimmed = value.trim();
  const full = FULL_DATE.exec(trimmed);
  if (full) {
    return `${full[3]}-${full[2]}-${full[1]}`;
  }
  const short = shortYears ? SHORT_DATE.exec(trimmed) : null;
  return short ? `20${short[3]}-${short[2]}-${short[1]}` : null;
}

export function findCell(
  line: StatementLine,
  matches: (text: string) => boolean,
): StatementCell | undefined {
  return line.cells.find(cell => matches(cell.text));
}

/**
 * The value printed under a label: the first cell on the next few lines that
 * lines up with the label and parses.
 */
export function valueBelow<T>(
  lines: StatementLine[],
  labelIndex: number,
  label: StatementCell,
  parse: (text: string) => T | null,
  maxLines = 3,
): T | null {
  for (const line of lines.slice(labelIndex + 1, labelIndex + 1 + maxLines)) {
    for (const cell of line.cells) {
      if (Math.abs(cell.x - label.x) > COLUMN_TOLERANCE) {
        continue;
      }
      const value = parse(cell.text);
      if (value != null) {
        return value;
      }
    }
  }
  return null;
}

/** The value printed under the first cell `matches` accepts. */
export function valueUnderLabel<T>(
  lines: StatementLine[],
  matches: (text: string) => boolean,
  parse: (text: string) => T | null,
): T | null {
  for (const [index, line] of lines.entries()) {
    const label = findCell(line, matches);
    if (label) {
      return valueBelow(lines, index, label, parse);
    }
  }
  return null;
}

/** The value printed right after a label on the same line. */
export function valueAfter<T>(
  line: StatementLine,
  matches: (text: string) => boolean,
  parse: (text: string) => T | null,
): T | null {
  const index = line.cells.findIndex(cell => matches(cell.text));
  const next = index < 0 ? undefined : line.cells[index + 1];
  return next ? parse(next.text) : null;
}

export function lastFourDigits(text: string): string | null {
  const match = /(\d{4})\s*$/.exec(text.trim());
  return match ? match[1] : null;
}

export function required<T>(value: T | null | undefined, field: string): T {
  if (value == null) {
    throw new StatementParseError(`Could not read the ${field}`);
  }
  return value;
}
