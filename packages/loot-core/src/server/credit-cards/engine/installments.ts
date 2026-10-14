import type { Cents, InstallmentInfo } from './types';

export const MAX_INSTALLMENTS = 48;

function asInstallment(number: number, count: number): InstallmentInfo | null {
  if (
    !Number.isInteger(number) ||
    !Number.isInteger(count) ||
    number < 1 ||
    count < 2 ||
    number > count ||
    count > MAX_INSTALLMENTS
  ) {
    return null;
  }
  return { number, count };
}

export function installmentFrom(
  number: number | null | undefined,
  count: number | null | undefined,
): InstallmentInfo | null {
  if (number == null || count == null) {
    return null;
  }
  return asInstallment(Number(number), Number(count));
}

const LABELLED =
  /(?:parcela|parc\.?)\s*0*(\d{1,2})\s*(?:de|\/)\s*0*(\d{1,2})(?!\d)/i;
const BARE = /(?:^|[^\d/])0*(\d{1,2})\s*\/\s*0*(\d{1,2})(?!\d|\/)/;

/**
 * Installment marker in a bank description: `PARC 02/06`, `PARCELA 2 DE 6`
 * or a bare `2/6`. A date such as `10/10/2026` is left alone.
 */
export function parseInstallmentLabel(text: string): InstallmentInfo | null {
  const labelled = LABELLED.exec(text);
  if (labelled) {
    return asInstallment(Number(labelled[1]), Number(labelled[2]));
  }
  const bare = BARE.exec(text);
  if (bare) {
    return asInstallment(Number(bare[1]), Number(bare[2]));
  }
  return null;
}

/**
 * Description reduced to what stays the same across the installments of one
 * purchase: no accents, no case, no installment marker, single spaces.
 */
export function descriptionStem(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(new RegExp(LABELLED.source, 'gi'), ' ')
    .replace(/(^|[^\d/])0*\d{1,2}\s*\/\s*0*\d{1,2}(?!\d|\/)/g, '$1 ')
    .replace(/[^A-Z0-9*]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * `total` split into `count` parts that always add back up to `total`.
 * Leftover cents go to the first installments.
 */
export function splitInstallments(total: Cents, count: number): Cents[] {
  if (!Number.isInteger(total)) {
    throw new Error('installment total must be integer cents');
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
    throw new Error(
      `installment count must be an integer from 1 to ${MAX_INSTALLMENTS}`,
    );
  }
  const sign = total < 0 ? -1 : 1;
  const absolute = Math.abs(total);
  const base = Math.floor(absolute / count);
  const remainder = absolute % count;
  return Array.from(
    { length: count },
    (_, index) => sign * (base + (index < remainder ? 1 : 0)),
  );
}
