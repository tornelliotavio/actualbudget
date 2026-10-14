import { v5 as uuidv5 } from 'uuid';

import { monthsBetween } from './bill-calendar';
import type { DateString, MonthString, Purchase } from './types';
import { isProjecting } from './types';

const PURCHASE_NAMESPACE = 'b8f0b1f4-5b8e-4b8f-9a77-0d6c0a3c2e51';

export type AnchorStrength = 'strong' | 'weak';

/** A real installment transaction waiting to be tied to a purchase. */
export type InstallmentCandidate = {
  entryId: string;
  /** Stable sort key shared by every device: the bank id when there is one. */
  sortKey: string;
  storedPurchaseId: string | null;
  number: number;
  count: number;
  stem: string;
  cardLast4: string | null;
  amount: number;
  /** Bill this installment is on, when the bank said so or it was inferred. */
  billMonth: MonthString;
  anchorMonth: MonthString;
  anchorStrength: AnchorStrength;
  purchaseDate: DateString | null;
  totalAmount: number | null;
};

/** A projected installment row already stored for a purchase. */
export type ProjectedSlot = {
  purchaseId: string;
  number: number;
  count: number;
  billMonth: MonthString;
  amount: number;
};

export type PurchaseSuggestion = {
  kind: 'ambiguous-installment';
  entryId: string;
  purchaseIds: string[];
};

export type PurchaseAssignment = {
  /** Purchase of each candidate, by entry id. */
  purchaseByEntry: Map<string, string>;
  /** Every purchase after this run, new ones included, anchors updated. */
  purchases: Purchase[];
  /** Purchases folded into another one; their rows move to the survivor. */
  mergedInto: Map<string, string>;
  suggestions: PurchaseSuggestion[];
};

export function purchaseId(
  accountId: string,
  identity: Pick<
    Purchase,
    'stem' | 'installmentCount' | 'cardLast4' | 'anchorMonth'
  >,
  tiebreak: string,
): string {
  return uuidv5(
    [
      accountId,
      identity.stem,
      identity.installmentCount,
      identity.cardLast4 ?? '',
      identity.anchorMonth,
      tiebreak,
    ].join('|'),
    PURCHASE_NAMESPACE,
  );
}

function sameCard(a: string | null, b: string | null) {
  return a == null || b == null || a === b;
}

function anchorsCompatible(
  purchase: Purchase,
  candidate: InstallmentCandidate,
) {
  const distance = Math.abs(
    monthsBetween(purchase.anchorMonth, candidate.anchorMonth),
  );
  if (distance === 0) {
    return true;
  }
  return distance === 1 && candidate.anchorStrength === 'weak';
}

function closeAmount(a: number, b: number, count: number) {
  return Math.abs(Math.abs(a) - Math.abs(b)) <= count;
}

/**
 * Ties installment transactions to purchases. Identical input produces
 * identical ids on every device: candidates are processed in a stable order
 * and a new purchase takes its id from its own first installment.
 */
export function assignPurchases(
  accountId: string,
  candidates: InstallmentCandidate[],
  existing: Purchase[],
  projected: ProjectedSlot[],
  realSlots: Array<{
    entryId: string;
    purchaseId: string;
    number: number;
    amount: number;
  }>,
): PurchaseAssignment {
  const purchases = new Map(
    existing.map(purchase => [purchase.id, { ...purchase }]),
  );
  const purchaseByEntry = new Map<string, string>();
  const suggestions: PurchaseSuggestion[] = [];
  const occupied = new Map<string, Map<number, string>>();
  const amounts = new Map<string, number[]>();

  function occupy(
    purchase: string,
    number: number,
    entryId: string,
    amount: number,
  ) {
    let slots = occupied.get(purchase);
    if (!slots) {
      slots = new Map();
      occupied.set(purchase, slots);
    }
    slots.set(number, entryId);
    amounts.set(purchase, [...(amounts.get(purchase) ?? []), amount]);
  }

  for (const slot of realSlots) {
    occupy(slot.purchaseId, slot.number, slot.entryId, slot.amount);
  }

  const ordered = [...candidates].sort(
    (a, b) =>
      a.stem.localeCompare(b.stem) ||
      a.count - b.count ||
      a.number - b.number ||
      a.sortKey.localeCompare(b.sortKey),
  );

  for (const candidate of ordered) {
    if (
      candidate.storedPurchaseId &&
      purchases.has(candidate.storedPurchaseId)
    ) {
      purchaseByEntry.set(candidate.entryId, candidate.storedPurchaseId);
      continue;
    }

    const slotFree = (purchase: Purchase) => {
      const holder = occupied.get(purchase.id)?.get(candidate.number);
      return holder == null || holder === candidate.entryId;
    };

    const byDescription = [...purchases.values()].filter(
      // A purchase whose projections stopped still owns its installments.
      purchase =>
        purchase.stem === candidate.stem &&
        purchase.installmentCount === candidate.count &&
        sameCard(purchase.cardLast4, candidate.cardLast4) &&
        anchorsCompatible(purchase, candidate) &&
        slotFree(purchase) &&
        (amounts.get(purchase.id) ?? []).every(amount =>
          closeAmount(amount, candidate.amount, candidate.count),
        ),
    );
    byDescription.sort(
      (a, b) =>
        Math.abs(monthsBetween(a.anchorMonth, candidate.anchorMonth)) -
          Math.abs(monthsBetween(b.anchorMonth, candidate.anchorMonth)) ||
        a.id.localeCompare(b.id),
    );

    let chosen: Purchase | undefined = byDescription[0];

    if (!chosen) {
      const bySlot = projected.filter(
        slot =>
          slot.number === candidate.number &&
          slot.count === candidate.count &&
          slot.billMonth === candidate.billMonth &&
          closeAmount(slot.amount, candidate.amount, candidate.count) &&
          isProjecting(purchases.get(slot.purchaseId)?.status ?? 'dismissed') &&
          slotFree(purchases.get(slot.purchaseId)!),
      );
      const ids = [...new Set(bySlot.map(slot => slot.purchaseId))];
      if (ids.length === 1) {
        chosen = purchases.get(ids[0]);
      } else if (ids.length > 1) {
        suggestions.push({
          kind: 'ambiguous-installment',
          entryId: candidate.entryId,
          purchaseIds: ids.sort(),
        });
      }
    }

    if (!chosen) {
      const identity = {
        stem: candidate.stem,
        installmentCount: candidate.count,
        cardLast4: candidate.cardLast4,
        anchorMonth: candidate.anchorMonth,
      };
      chosen = {
        id: purchaseId(accountId, identity, candidate.sortKey),
        ...identity,
        purchaseDate: candidate.purchaseDate,
        totalAmount: candidate.totalAmount,
        status: 'active',
      };
      purchases.set(chosen.id, chosen);
    } else if (
      candidate.anchorStrength === 'strong' &&
      chosen.anchorMonth !== candidate.anchorMonth
    ) {
      chosen = { ...chosen, anchorMonth: candidate.anchorMonth };
      purchases.set(chosen.id, chosen);
    }

    if (chosen.purchaseDate == null && candidate.purchaseDate != null) {
      chosen = { ...chosen, purchaseDate: candidate.purchaseDate };
      purchases.set(chosen.id, chosen);
    }
    if (chosen.totalAmount == null && candidate.totalAmount != null) {
      chosen = { ...chosen, totalAmount: candidate.totalAmount };
      purchases.set(chosen.id, chosen);
    }

    purchaseByEntry.set(candidate.entryId, chosen.id);
    occupy(chosen.id, candidate.number, candidate.entryId, candidate.amount);
  }

  const mergedInto = mergeDuplicatePurchases(purchases, occupied);
  for (const [entryId, purchase] of purchaseByEntry) {
    const survivor = mergedInto.get(purchase);
    if (survivor) {
      purchaseByEntry.set(entryId, survivor);
    }
  }

  return {
    purchaseByEntry,
    purchases: [...purchases.values()].filter(
      purchase => !mergedInto.has(purchase.id),
    ),
    mergedInto,
    suggestions,
  };
}

/**
 * Two devices that saw different installments of one purchase can create it
 * twice. Purchases with the same identity whose installments don't overlap
 * fold into the one with the smallest id.
 */
function mergeDuplicatePurchases(
  purchases: Map<string, Purchase>,
  occupied: Map<string, Map<number, string>>,
): Map<string, string> {
  const groups = new Map<string, Purchase[]>();
  for (const purchase of purchases.values()) {
    if (!isProjecting(purchase.status)) {
      continue;
    }
    const key = [
      purchase.stem,
      purchase.installmentCount,
      purchase.cardLast4 ?? '',
      purchase.anchorMonth,
    ].join('|');
    groups.set(key, [...(groups.get(key) ?? []), purchase]);
  }

  const mergedInto = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    group.sort((a, b) => a.id.localeCompare(b.id));
    const [survivor, ...others] = group;
    const taken = new Set(occupied.get(survivor.id)?.keys() ?? []);
    for (const other of others) {
      const numbers = [...(occupied.get(other.id)?.keys() ?? [])];
      if (numbers.some(number => taken.has(number))) {
        continue;
      }
      numbers.forEach(number => taken.add(number));
      mergedInto.set(other.id, survivor.id);
    }
  }
  return mergedInto;
}
