import { addMonths } from '#shared/months';

import type { BillCalendar } from './bill-calendar';
import { clampDay, monthsBetween } from './bill-calendar';
import type { ClassifyOptions } from './classify';
import { classifyEntry, entryInstallment } from './classify';
import { projectedInstallmentId } from './ids';
import { descriptionStem, splitInstallments } from './installments';
import type {
  AnchorStrength,
  InstallmentCandidate,
  ProjectedSlot,
  PurchaseSuggestion,
} from './purchases';
import { assignPurchases } from './purchases';
import type {
  BillSource,
  CardEntry,
  CardEntryKind,
  Cents,
  DateString,
  MonthString,
  Purchase,
} from './types';
import { isProjecting } from './types';

export type PlanInput = {
  accountId: string;
  calendar: BillCalendar;
  /** Reference month of each bill the bank identified, by its bill id. */
  billMonthByProviderId: Map<string, MonthString>;
  entries: CardEntry[];
  purchases: Purchase[];
  /** Projected rows that were deleted; they are never recreated. */
  deletedProjectedIds: Set<string>;
  today: DateString;
  classify?: ClassifyOptions;
};

/** Card columns a transaction should end up with. */
export type EntryPlan = {
  id: string;
  bill: MonthString;
  billSource: BillSource;
  kind: CardEntryKind;
  purchaseId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  date: DateString;
  /** Date the budget counts the transaction on; null for bill payments. */
  budgetDate: DateString | null;
};

export type ProjectedPlan = EntryPlan & {
  purchaseId: string;
  installmentNumber: number;
  installmentCount: number;
  amount: Cents;
  /** Transaction to copy payee, category and notes from. */
  templateId: string;
};

export type PlanSuggestion =
  | PurchaseSuggestion
  | { kind: 'missing-installment'; purchaseId: string; number: number }
  | { kind: 'cancelled-purchase'; purchaseId: string; creditId: string };

export type CardPlan = {
  entries: EntryPlan[];
  projected: ProjectedPlan[];
  /** Projected rows to delete: superseded, stale or of a cancelled purchase. */
  removeProjected: string[];
  purchases: Purchase[];
  /** Purchases folded into another; delete them. */
  removePurchases: string[];
  /**
   * Real installments that took the place of a projected one: what the user
   * set on the projection (category, payee) carries over to the real row.
   */
  inherit: Array<{ fromId: string; toId: string }>;
  months: MonthString[];
  suggestions: PlanSuggestion[];
};

type Resolved = {
  entry: CardEntry;
  kind: CardEntryKind;
  ownBill: MonthString;
  ownBillSource: BillSource;
  stem: string;
};

function installmentDate(
  calendar: BillCalendar,
  purchaseDate: DateString | null,
  fallback: DateString,
  number: number,
  bill: MonthString,
): DateString {
  const period = calendar.period(bill);
  const candidate =
    purchaseDate == null
      ? fallback
      : clampDay(
          addMonths(purchaseDate.slice(0, 7), number - 1),
          Number(purchaseDate.slice(8, 10)),
        );
  if (candidate < period.startDate) {
    return period.startDate;
  }
  if (candidate > period.endDate) {
    return period.endDate;
  }
  return candidate;
}

function resolveOwnBill(
  input: PlanInput,
  entry: CardEntry,
  kind: CardEntryKind,
): { bill: MonthString; source: BillSource } {
  const storedSource = entry.stored.billSource;
  if (
    (storedSource === 'user' || storedSource === 'adjustment') &&
    entry.stored.bill
  ) {
    return { bill: entry.stored.bill, source: storedSource };
  }
  if (kind === 'payment') {
    // A payment pays the bill that closed most recently before it.
    return {
      bill: addMonths(input.calendar.monthForDate(entry.date), -1),
      source: 'cycle',
    };
  }
  const providerBill = entry.provider?.billId
    ? input.billMonthByProviderId.get(entry.provider.billId)
    : undefined;
  if (providerBill) {
    return { bill: providerBill, source: 'provider' };
  }
  // Banks bill a charge by the day it posted, which can be days after the
  // purchase: a purchase made right before closing may post after it.
  const postDate = entry.provider?.postDate;
  if (postDate) {
    return {
      bill: input.calendar.monthForPostDate(postDate),
      source: 'provider',
    };
  }
  return { bill: input.calendar.monthForDate(entry.date), source: 'cycle' };
}

function anchorFor(
  input: PlanInput,
  resolved: Resolved,
  number: number,
): { month: MonthString; strength: AnchorStrength } {
  const { entry, ownBillSource, ownBill } = resolved;
  if (ownBillSource === 'provider' || ownBillSource === 'user') {
    return { month: addMonths(ownBill, -(number - 1)), strength: 'strong' };
  }
  const purchaseDate = entry.provider?.purchaseDate ?? null;
  if (purchaseDate) {
    return {
      month: input.calendar.monthForDate(purchaseDate),
      strength: 'strong',
    };
  }
  if (number === 1) {
    return {
      month: input.calendar.monthForDate(entry.date),
      strength: 'strong',
    };
  }
  return {
    month: addMonths(input.calendar.monthForDate(entry.date), -(number - 1)),
    strength: 'weak',
  };
}

/**
 * Desired card state of one account, computed from its transactions and
 * what the bank reported. Pure: the caller diffs it against storage.
 */
export function planCardAccount(input: PlanInput): CardPlan {
  const { calendar, accountId } = input;
  const real = input.entries.filter(entry => !entry.projected);
  const storedProjected = input.entries.filter(entry => entry.projected);

  const resolved: Resolved[] = real.map(entry => {
    const kind =
      entry.stored.billSource === 'adjustment'
        ? 'fee'
        : classifyEntry(entry, input.classify);
    const own = resolveOwnBill(input, entry, kind);
    return {
      entry,
      kind,
      ownBill: own.bill,
      ownBillSource: own.source,
      stem: descriptionStem(entry.description),
    };
  });

  const installments = resolved.filter(item => item.kind === 'installment');
  const candidates: InstallmentCandidate[] = installments.map(item => {
    const info = entryInstallment(item.entry)!;
    const anchor = anchorFor(input, item, info.number);
    return {
      entryId: item.entry.id,
      sortKey: item.entry.importedId ?? item.entry.id,
      storedPurchaseId: item.entry.stored.purchaseId,
      number: info.number,
      count: info.count,
      stem: item.stem,
      cardLast4: item.entry.provider?.cardLast4 ?? null,
      amount: item.entry.amount,
      billMonth: item.ownBill,
      anchorMonth: anchor.month,
      anchorStrength: anchor.strength,
      purchaseDate:
        item.entry.provider?.purchaseDate ??
        (info.number === 1 ? item.entry.date : null),
      totalAmount: item.entry.provider?.totalAmount ?? null,
    };
  });

  const projectedSlots: ProjectedSlot[] = storedProjected
    .filter(
      entry =>
        entry.stored.purchaseId &&
        entry.stored.installmentNumber &&
        entry.stored.installmentCount &&
        entry.stored.bill,
    )
    .map(entry => ({
      purchaseId: entry.stored.purchaseId!,
      number: entry.stored.installmentNumber!,
      count: entry.stored.installmentCount!,
      billMonth: entry.stored.bill!,
      amount: entry.amount,
    }));

  const realSlots = installments
    .filter(item => item.entry.stored.purchaseId)
    .map(item => ({
      entryId: item.entry.id,
      purchaseId: item.entry.stored.purchaseId!,
      number: entryInstallment(item.entry)!.number,
      amount: item.entry.amount,
    }));

  const assignment = assignPurchases(
    accountId,
    candidates,
    input.purchases,
    projectedSlots,
    realSlots,
  );
  const purchases = new Map(
    assignment.purchases.map(purchase => [purchase.id, purchase]),
  );
  const suggestions: PlanSuggestion[] = [...assignment.suggestions];

  const membersByPurchase = new Map<string, Resolved[]>();
  for (const item of installments) {
    const purchaseId = assignment.purchaseByEntry.get(item.entry.id)!;
    membersByPurchase.set(purchaseId, [
      ...(membersByPurchase.get(purchaseId) ?? []),
      item,
    ]);
  }

  cancelRefundedPurchases(resolved, purchases, membersByPurchase, suggestions);

  const entries: EntryPlan[] = resolved.map(item => {
    const { entry, kind } = item;
    const budgetDate = (bill: MonthString) =>
      kind === 'payment' ? null : calendar.period(bill).budgetDate;

    if (kind !== 'installment') {
      return {
        id: entry.id,
        bill: item.ownBill,
        billSource: item.ownBillSource,
        kind,
        purchaseId: null,
        installmentNumber: null,
        installmentCount: null,
        date: entry.date,
        budgetDate: budgetDate(item.ownBill),
      };
    }

    const info = entryInstallment(entry)!;
    const purchase = purchases.get(assignment.purchaseByEntry.get(entry.id)!)!;
    let bill = item.ownBill;
    let billSource = item.ownBillSource;
    if (billSource === 'cycle') {
      bill = addMonths(purchase.anchorMonth, info.number - 1);
      billSource = 'installment';
    }
    return {
      id: entry.id,
      bill,
      billSource,
      kind,
      purchaseId: purchase.id,
      installmentNumber: info.number,
      installmentCount: info.count,
      date: installmentDate(
        calendar,
        purchase.purchaseDate,
        entry.date,
        info.number,
        bill,
      ),
      budgetDate: budgetDate(bill),
    };
  });

  const projected = projectPurchases(
    input,
    purchases,
    membersByPurchase,
    suggestions,
  );
  const keep = new Set(projected.map(row => row.id));
  const removeProjected = storedProjected
    .map(entry => entry.id)
    .filter(id => !keep.has(id));

  const projectedBySlot = new Map(
    storedProjected
      .filter(
        entry => entry.stored.purchaseId && entry.stored.installmentNumber,
      )
      .map(entry => [
        `${assignment.mergedInto.get(entry.stored.purchaseId!) ?? entry.stored.purchaseId}|${entry.stored.installmentNumber}`,
        entry.id,
      ]),
  );
  const inherit = entries.flatMap(entry => {
    const fromId =
      entry.purchaseId &&
      projectedBySlot.get(`${entry.purchaseId}|${entry.installmentNumber}`);
    return fromId && !keep.has(fromId) ? [{ fromId, toId: entry.id }] : [];
  });

  const months = [
    ...new Set([
      ...entries.map(entry => entry.bill),
      ...projected.map(row => row.bill),
    ]),
  ].sort();

  return {
    entries,
    projected,
    removeProjected,
    purchases: [...purchases.values()],
    removePurchases: [...assignment.mergedInto.keys()],
    inherit,
    months,
    suggestions,
  };
}

/**
 * A credit that matches what is left of an installment purchase is a refund
 * of that purchase: its remaining installments will never be charged.
 */
function cancelRefundedPurchases(
  resolved: Resolved[],
  purchases: Map<string, Purchase>,
  membersByPurchase: Map<string, Resolved[]>,
  suggestions: PlanSuggestion[],
) {
  const credits = resolved.filter(item => item.kind === 'credit');
  for (const credit of credits) {
    const matches = [...purchases.values()].filter(purchase => {
      if (purchase.status !== 'active' || purchase.stem !== credit.stem) {
        return false;
      }
      const members = membersByPurchase.get(purchase.id) ?? [];
      if (members.length === 0) {
        return false;
      }
      const latest = members.reduce((a, b) =>
        entryInstallment(a.entry)!.number > entryInstallment(b.entry)!.number
          ? a
          : b,
      );
      const unbilled =
        purchase.installmentCount - entryInstallment(latest.entry)!.number;
      if (
        unbilled <= 0 ||
        monthsBetween(purchase.anchorMonth, credit.ownBill) < 0
      ) {
        return false;
      }
      const refund = credit.entry.amount;
      const tolerance = purchase.installmentCount;
      const candidates = [
        Math.abs(latest.entry.amount) * unbilled,
        purchase.totalAmount == null ? null : Math.abs(purchase.totalAmount),
        Math.abs(latest.entry.amount) * purchase.installmentCount,
      ];
      return candidates.some(
        expected =>
          expected != null && Math.abs(expected - refund) <= tolerance,
      );
    });
    if (matches.length === 1) {
      const purchase = matches[0];
      purchases.set(purchase.id, { ...purchase, status: 'cancelled' });
      suggestions.push({
        kind: 'cancelled-purchase',
        purchaseId: purchase.id,
        creditId: credit.entry.id,
      });
    }
  }
}

function projectPurchases(
  input: PlanInput,
  purchases: Map<string, Purchase>,
  membersByPurchase: Map<string, Resolved[]>,
  suggestions: PlanSuggestion[],
): ProjectedPlan[] {
  const { calendar, accountId, today } = input;
  const rows: ProjectedPlan[] = [];

  for (const purchase of purchases.values()) {
    const members = membersByPurchase.get(purchase.id) ?? [];
    if (!isProjecting(purchase.status) || members.length === 0) {
      continue;
    }
    const byNumber = new Map(
      members.map(item => [entryInstallment(item.entry)!.number, item]),
    );
    const highest = Math.max(...byNumber.keys());
    if (highest >= purchase.installmentCount) {
      continue;
    }
    const latest = byNumber.get(highest)!;
    const remainingCount = purchase.installmentCount - highest;

    let amounts: Cents[] = Array(remainingCount).fill(latest.entry.amount);
    if (purchase.totalAmount != null) {
      // Installments the bank never sent are assumed equal to the latest one.
      const billed =
        members.reduce((sum, item) => sum + item.entry.amount, 0) +
        latest.entry.amount * (highest - byNumber.size);
      const left = -Math.abs(purchase.totalAmount) - billed;
      if (left < 0) {
        amounts = splitInstallments(left, remainingCount);
      }
    }

    for (
      let number = highest + 1;
      number <= purchase.installmentCount;
      number++
    ) {
      const id = projectedInstallmentId(accountId, purchase.id, number);
      if (input.deletedProjectedIds.has(id)) {
        continue;
      }
      const bill = addMonths(purchase.anchorMonth, number - 1);
      const period = calendar.period(bill);
      if (today > period.effectiveDueDate) {
        suggestions.push({
          kind: 'missing-installment',
          purchaseId: purchase.id,
          number,
        });
        continue;
      }
      rows.push({
        id,
        bill,
        billSource: 'installment',
        kind: 'installment',
        purchaseId: purchase.id,
        installmentNumber: number,
        installmentCount: purchase.installmentCount,
        date: installmentDate(
          calendar,
          purchase.purchaseDate,
          period.startDate,
          number,
          bill,
        ),
        budgetDate: period.budgetDate,
        amount: amounts[number - highest - 1],
        templateId: latest.entry.id,
      });
    }
  }
  return rows;
}
