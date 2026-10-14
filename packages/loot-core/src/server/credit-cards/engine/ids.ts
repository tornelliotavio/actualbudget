import { v5 as uuidv5 } from 'uuid';

import type { MonthString } from './types';

const PROJECTED_NAMESPACE = '6a0f3d4e-8d7c-4f61-a3a5-2f1b9c7e4d10';
const ADJUSTMENT_NAMESPACE = 'c2d7e9a1-3b64-4c0e-9f2d-71a8b5e6f304';

/** Transaction id of the projected installment `number` of a purchase. */
export function projectedInstallmentId(
  accountId: string,
  purchaseId: string,
  number: number,
): string {
  return uuidv5(`${accountId}|${purchaseId}|${number}`, PROJECTED_NAMESPACE);
}

/** Transaction id of the finance-charge adjustment of a bill. */
export function billAdjustmentId(
  accountId: string,
  referenceMonth: MonthString,
): string {
  return uuidv5(`${accountId}|${referenceMonth}`, ADJUSTMENT_NAMESPACE);
}

/** Id of the bill row of a card for one reference month. */
export function billRowId(accountId: string, referenceMonth: MonthString) {
  return `${accountId}:${referenceMonth}`;
}
