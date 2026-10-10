import { amountToInteger } from '#shared/util';

import { addCalendarMonths } from './cycles';
import { purchaseFingerprint } from './ids';
import { normalizeDescription, splitInstallments } from './installments';
import { readCardMetadata } from './metadata';

const MAX_INSTALLMENTS = 48;
const PURCHASE_DATE_TOLERANCE_DAYS = 3;

export type PlannedPart = {
  number: number;
  amount: number;
  date: string;
  transactionId: string | null;
};

export type InstallmentPlan = {
  id: string;
  cardId: string;
  purchaseDate: string;
  merchant: string | null;
  notes: string | null;
  description: string;
  totalAmount: number;
  installmentCount: number;
  parts: PlannedPart[];
};

export type InstallmentConflict = {
  transactionId: string;
  planId: string;
  number: number;
};

export type InstallmentTransaction = {
  id: string;
  date: string;
  amount: number;
  notes: string | null;
  payeeName: string | null;
  transferId: string | null;
  rawSyncedData: string | null;
  startingBalance?: boolean;
  isParent?: boolean;
};

type Sighting = {
  transactionId: string;
  date: string;
  amount: number;
  number: number;
  count: number;
  inferred: string;
  explicitPurchaseDate: string | null;
  totalAmount: number | null;
  description: string;
  merchant: string | null;
  notes: string | null;
  bucket: string;
};

type Group = {
  anchor: string;
  sightings: Sighting[];
  conflicts: Sighting[];
};

function isIsoDate(value: string | null | undefined): value is string {
  return value != null && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function centsFromReais(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const cents = amountToInteger(value);
  if (!Number.isInteger(cents) || cents <= 0) {
    return null;
  }
  return cents;
}

function daysBetween(left: string, right: string): number {
  const utc = (iso: string) =>
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10)),
    );
  return Math.round((utc(right) - utc(left)) / 86_400_000);
}

function compareSightings(left: Sighting, right: Sighting): number {
  if (left.inferred !== right.inferred) {
    return left.inferred < right.inferred ? -1 : 1;
  }
  if (left.number !== right.number) {
    return left.number - right.number;
  }
  if (left.transactionId === right.transactionId) {
    return 0;
  }
  return left.transactionId < right.transactionId ? -1 : 1;
}

function sightingFrom(transaction: InstallmentTransaction): Sighting | null {
  if (
    transaction.isParent ||
    transaction.startingBalance ||
    transaction.transferId ||
    transaction.amount >= 0 ||
    !isIsoDate(transaction.date)
  ) {
    return null;
  }
  const metadata = readCardMetadata(transaction.rawSyncedData);
  const count = metadata?.totalInstallments ?? null;
  const number = metadata?.installmentNumber ?? null;
  if (
    count == null ||
    number == null ||
    !Number.isInteger(count) ||
    !Number.isInteger(number) ||
    count < 2 ||
    count > MAX_INSTALLMENTS ||
    number < 1 ||
    number > count
  ) {
    return null;
  }
  const amount = Math.abs(transaction.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }
  const explicitPurchaseDate = isIsoDate(metadata?.purchaseDate)
    ? metadata.purchaseDate
    : null;
  const inferred =
    explicitPurchaseDate ?? addCalendarMonths(transaction.date, 1 - number);
  const description = transaction.payeeName || transaction.notes || '';
  return {
    transactionId: transaction.id,
    date: transaction.date,
    amount,
    number,
    count,
    inferred,
    explicitPurchaseDate,
    totalAmount: centsFromReais(metadata?.totalAmount ?? null),
    description,
    merchant: transaction.payeeName,
    notes: transaction.notes,
    bucket: [
      normalizeDescription(description),
      String(count),
      String(amount),
    ].join('\0'),
  };
}

function groupSightings(sightings: Sighting[]): Group[] {
  const ordered = sightings.slice().sort(compareSightings);
  const groups: Group[] = [];
  for (const sighting of ordered) {
    const group = groups.find(
      item =>
        item.sightings[0]?.bucket === sighting.bucket &&
        Math.abs(daysBetween(item.anchor, sighting.inferred)) <=
          PURCHASE_DATE_TOLERANCE_DAYS,
    );
    if (!group) {
      groups.push({
        anchor: sighting.inferred,
        sightings: [sighting],
        conflicts: [],
      });
      continue;
    }
    if (group.sightings.some(item => item.number === sighting.number)) {
      group.conflicts.push(sighting);
      continue;
    }
    group.sightings.push(sighting);
  }
  return groups;
}

function planFromGroup(cardId: string, group: Group): InstallmentPlan | null {
  const ordered = group.sightings
    .slice()
    .sort((left, right) => left.number - right.number);
  const anchor = ordered[0];
  if (anchor == null) {
    return null;
  }
  const purchaseDate = anchor.explicitPurchaseDate ?? anchor.inferred;
  const explicitTotals: number[] = [];
  for (const sighting of ordered) {
    if (sighting.totalAmount != null) {
      explicitTotals.push(sighting.totalAmount);
    }
  }
  const agreedTotal = explicitTotals[0];
  const totalAmount =
    agreedTotal != null && explicitTotals.every(value => value === agreedTotal)
      ? agreedTotal
      : anchor.amount * anchor.count;
  const amounts = splitInstallments(totalAmount, anchor.count);
  const seen = new Map(ordered.map(sighting => [sighting.number, sighting]));
  const parts: PlannedPart[] = [];
  for (let index = 0; index < amounts.length; index++) {
    const number = index + 1;
    const amount = amounts[index];
    if (amount == null) {
      continue;
    }
    const match = seen.get(number);
    parts.push({
      number,
      amount,
      date: addCalendarMonths(purchaseDate, number - 1),
      transactionId: match?.transactionId ?? null,
    });
  }
  return {
    id: purchaseFingerprint({
      cardId,
      purchaseDate,
      totalAmount,
      installmentCount: anchor.count,
      description: anchor.description,
    }),
    cardId,
    purchaseDate,
    merchant: anchor.merchant,
    notes: anchor.notes,
    description: anchor.description,
    totalAmount,
    installmentCount: anchor.count,
    parts,
  };
}

/**
 * Group posted installment charges into purchases. Banks often omit the
 * purchase date and the full total, and a later installment's own date is
 * not the purchase date. Walking each charge back by its installment number
 * puts them on one purchase. A missing earlier part is not projected: only
 * parts after the latest one already posted still belong to a future bill.
 */
export function planInstallments(
  cardId: string,
  transactions: readonly InstallmentTransaction[],
): { plans: InstallmentPlan[]; conflicts: InstallmentConflict[] } {
  const sightings: Sighting[] = [];
  for (const transaction of transactions) {
    const sighting = sightingFrom(transaction);
    if (sighting) {
      sightings.push(sighting);
    }
  }
  const plans: InstallmentPlan[] = [];
  const conflicts: InstallmentConflict[] = [];
  for (const group of groupSightings(sightings)) {
    const plan = planFromGroup(cardId, group);
    if (plan == null) {
      continue;
    }
    plans.push(plan);
    for (const conflict of group.conflicts) {
      conflicts.push({
        transactionId: conflict.transactionId,
        planId: plan.id,
        number: conflict.number,
      });
    }
  }
  return { plans, conflicts };
}

export function unpostedInstallments(plan: InstallmentPlan): PlannedPart[] {
  let maxSeen = 0;
  for (const part of plan.parts) {
    if (part.transactionId != null && part.number > maxSeen) {
      maxSeen = part.number;
    }
  }
  return plan.parts.filter(
    part => part.transactionId == null && part.number > maxSeen,
  );
}
