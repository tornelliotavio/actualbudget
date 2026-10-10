import type { Cents } from './types';

export type InstallmentLabel = {
  number: number;
  total: number;
};

const MAX_INSTALLMENTS = 48;

/**
 * Split `totalCents` into `count` installments. Leftover cents go to the
 * earliest installments, so the parts always sum to the original total.
 */
export function splitInstallments(totalCents: Cents, count: number): Cents[] {
  if (!Number.isInteger(totalCents)) {
    throw new Error('installment total must be integer cents');
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALLMENTS) {
    throw new Error(
      `installment count must be an integer from 1 to ${MAX_INSTALLMENTS}`,
    );
  }
  const sign = totalCents < 0 ? -1 : 1;
  const absolute = Math.abs(totalCents);
  const base = Math.floor(absolute / count);
  const remainder = absolute % count;
  const parts: Cents[] = [];
  for (let index = 0; index < count; index++) {
    const extra = index < remainder ? 1 : 0;
    parts.push(sign * (base + extra));
  }
  return parts;
}

function asLabel(current: number, total: number): InstallmentLabel | null {
  if (
    !Number.isInteger(current) ||
    !Number.isInteger(total) ||
    current < 1 ||
    total < 1 ||
    current > total ||
    total > MAX_INSTALLMENTS
  ) {
    return null;
  }
  return { number: current, total };
}

/**
 * Pull an installment marker out of a bank description.
 * Matches `PARC 02/06`, `PARCELA 2 DE 6` and a bare `2/6`.
 * A following slash (`10/10/2026`) is left alone.
 */
export function parseInstallmentLabel(text: string): InstallmentLabel | null {
  const keyword =
    /(?:parcela|parc\.?)\s*0*(\d{1,2})\s*(?:de|\/)\s*0*(\d{1,2})(?!\d)/i.exec(
      text,
    );
  if (keyword) {
    return asLabel(Number(keyword[1]), Number(keyword[2]));
  }
  const bare = /(?:^|[^\d/])0*(\d{1,2})\s*\/\s*0*(\d{1,2})(?!\d|\/)/.exec(text);
  if (bare) {
    return asLabel(Number(bare[1]), Number(bare[2]));
  }
  return null;
}

export function normalizeDescription(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
