import type { CardBill } from '@actual-app/core/server/credit-cards/bills';

import { amountDue } from '#components/credit-cards/billStatus';
import type { BillOccurrence } from '#components/reports/reports/bills/billOccurrences';

/** Where a bill stands this month, most urgent first. */
export type HomeBillStatus =
  | 'overdue'
  | 'due'
  | 'partially_paid'
  | 'upcoming'
  | 'open'
  | 'scheduled'
  | 'paid';

export type HomeCardBill = Pick<
  CardBill,
  | 'referenceMonth'
  | 'closingDate'
  | 'effectiveDueDate'
  | 'status'
  | 'total'
  | 'paid'
  | 'remaining'
  | 'minimumPayment'
>;

/** A bill or expected income of the month, amounts in positive cents. */
export type HomeBill = {
  id: string;
  name: string;
  dueDate: string;
  status: HomeBillStatus;
  isIncome: boolean;
  isEstimate: boolean;
  /** What the bill asks for: the expected amount, or what was paid. */
  amount: number;
  /** What is still to pay; 0 once paid. */
  amountDue: number;
  paidAmount: number;
  scheduleId: string | null;
  /** The card a card bill is for. */
  cardAccountId: string | null;
  cardBill: HomeCardBill | null;
  /** The account the schedule pays from. */
  payFromAccountId: string | null;
  /** Paid, but the payment was recorded by hand and the bank hasn't sent it. */
  awaitingBank: boolean;
};

export type HomeBillTotals = {
  /** Expenses still to pay this month. */
  toPay: number;
  /** Expenses already paid this month. */
  paid: number;
  overdueCount: number;
  incomePending: number;
  incomeReceived: number;
};

export type HomeCard = {
  accountId: string;
  name: string;
  bills: readonly HomeCardBill[];
  /** Bill the card is on now: the oldest unpaid closed one, else the open one. */
  currentMonth?: string | null;
  available?: number | null;
};

export type MergeHomeBillsInput = {
  occurrences: readonly BillOccurrence[];
  month: string;
  /** Card account paid by each schedule that pays a card. */
  cardAccountsBySchedule: ReadonlyMap<string, string>;
  /** Account each schedule pays from. */
  scheduleAccounts: ReadonlyMap<string, string | null>;
  cards: readonly HomeCard[];
  /** Schedules whose payment this month has no bank copy yet. */
  awaitingBankScheduleIds?: ReadonlySet<string>;
};

const STATUS_ORDER: Record<HomeBillStatus, number> = {
  overdue: 0,
  due: 1,
  partially_paid: 2,
  upcoming: 3,
  open: 4,
  scheduled: 5,
  paid: 6,
};

function occurrenceStatus(status: BillOccurrence['status']): HomeBillStatus {
  return status === 'missed' ? 'overdue' : status;
}

/** A card bill's status where the schedule's would mislead: a partial payment isn't paid. */
function cardBillStatus(
  bill: HomeCardBill,
  occurrence: BillOccurrence | null,
): HomeBillStatus {
  switch (bill.status) {
    case 'paid':
    case 'overdue':
    case 'partially_paid':
      return bill.status;
    case 'open':
    case 'upcoming':
      return 'open';
    case 'closed':
      if (occurrence && occurrence.status !== 'paid') {
        return occurrenceStatus(occurrence.status);
      }
      return 'due';
    default:
      return bill.status satisfies never;
  }
}

function fromCardBill({
  id,
  name,
  card,
  bill,
  occurrence,
  payFromAccountId,
  awaitingBank,
}: {
  id: string;
  name: string;
  card: HomeCard;
  bill: HomeCardBill;
  occurrence: BillOccurrence | null;
  payFromAccountId: string | null;
  awaitingBank: boolean;
}): HomeBill {
  const status = cardBillStatus(bill, occurrence);
  return {
    id,
    name,
    dueDate: bill.effectiveDueDate,
    status,
    isIncome: false,
    isEstimate: false,
    amount: bill.total,
    amountDue: status === 'paid' ? 0 : Math.max(amountDue(bill), 0),
    paidAmount: bill.paid,
    scheduleId: occurrence?.scheduleId ?? null,
    cardAccountId: card.accountId,
    cardBill: bill,
    payFromAccountId,
    awaitingBank: status === 'paid' && awaitingBank,
  };
}

/**
 * The month's bills: schedule occurrences, with a card's own bill standing in
 * for the schedule that pays it, plus the bills of cards no schedule pays.
 */
export function mergeHomeBills({
  occurrences,
  month,
  cardAccountsBySchedule,
  scheduleAccounts,
  cards,
  awaitingBankScheduleIds = new Set(),
}: MergeHomeBillsInput): HomeBill[] {
  const cardsById = new Map(cards.map(card => [card.accountId, card]));
  const billOfMonth = (card: HomeCard | undefined) =>
    card?.bills.find(bill => bill.referenceMonth === month);
  const coveredCards = new Set<string>();

  const bills = occurrences.map((occurrence): HomeBill => {
    const payFromAccountId =
      scheduleAccounts.get(occurrence.scheduleId) ?? null;
    const awaitingBank = awaitingBankScheduleIds.has(occurrence.scheduleId);
    const cardAccountId = cardAccountsBySchedule.get(occurrence.scheduleId);
    const card = cardAccountId ? cardsById.get(cardAccountId) : undefined;
    const bill = billOfMonth(card);
    if (card && bill) {
      coveredCards.add(card.accountId);
      return fromCardBill({
        id: occurrence.id,
        name: occurrence.name,
        card,
        bill,
        occurrence,
        payFromAccountId,
        awaitingBank,
      });
    }

    const status = occurrenceStatus(occurrence.status);
    const amount = Math.abs(occurrence.amount);
    return {
      id: occurrence.id,
      name: occurrence.name,
      dueDate: occurrence.billDueDate ?? occurrence.date,
      status,
      isIncome: occurrence.isIncome,
      isEstimate: occurrence.isEstimate,
      amount,
      amountDue: status === 'paid' ? 0 : amount,
      paidAmount: status === 'paid' ? amount : 0,
      scheduleId: occurrence.scheduleId,
      cardAccountId: cardAccountId ?? null,
      cardBill: null,
      payFromAccountId,
      awaitingBank: status === 'paid' && awaitingBank,
    };
  });

  for (const card of cards) {
    const bill = billOfMonth(card);
    if (!bill || coveredCards.has(card.accountId) || bill.total <= 0) {
      continue;
    }
    bills.push(
      fromCardBill({
        id: `card-${card.accountId}-${month}`,
        name: card.name,
        card,
        bill,
        occurrence: null,
        payFromAccountId: null,
        awaitingBank: false,
      }),
    );
  }

  return bills.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      a.dueDate.localeCompare(b.dueDate) ||
      a.name.localeCompare(b.name),
  );
}

export function getHomeBillTotals(bills: readonly HomeBill[]): HomeBillTotals {
  return bills.reduce<HomeBillTotals>(
    (totals, bill) => {
      if (bill.isIncome) {
        if (bill.status === 'paid') {
          totals.incomeReceived += bill.amount;
        } else {
          totals.incomePending += bill.amountDue;
        }
        return totals;
      }
      totals.toPay += bill.amountDue;
      totals.paid += bill.status === 'paid' ? bill.amount : bill.paidAmount;
      if (bill.status === 'overdue') {
        totals.overdueCount += 1;
      }
      return totals;
    },
    { toPay: 0, paid: 0, overdueCount: 0, incomePending: 0, incomeReceived: 0 },
  );
}

/** Whether a bill can be paid from the overview. */
export function isPayable(bill: HomeBill) {
  return !bill.isIncome && bill.status !== 'paid' && bill.amountDue > 0;
}
