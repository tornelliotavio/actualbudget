export type ReportBillStatus =
  | 'overdue'
  | 'due'
  | 'upcoming'
  | 'open'
  | 'scheduled';

/**
 * A bill split with someone else: schedules whose name contains `match`, and
 * credit cards whose account name contains it, count only `share` of their
 * amounts (0.5 for half).
 */
export type ReportShare = { match: string; share: number };

/** A bill still to pay this month, in positive cents of the owner's part. */
export type PendingBill = {
  name: string;
  dueDate: string;
  amount: number;
  kind: 'card' | 'schedule';
  isEstimate: boolean;
  status: ReportBillStatus;
  /** The owner's part of the bill, 1 when it isn't split. */
  share: number;
  /** For a schedule, the category id of its last payment. */
  category: string | null;
};

/** The bills to remind the owner of. */
export type BillReminders = {
  overdue: PendingBill[];
  today: PendingBill[];
  tomorrow: PendingBill[];
};

/** A charge on a card bill still to pay this month, owner's part. */
export type BillItem = {
  bill: string;
  dueDate: string;
  date: string;
  label: string;
  category: string | null;
  amount: number;
};

/** The bill a card is on now, owner's part. */
export type ReportCard = {
  name: string;
  referenceMonth: string;
  dueDate: string;
  status: string;
  total: number;
  paid: number;
  due: number;
  share: number;
  limitTotal: number | null;
  limitUsed: number | null;
};

export type MonthAmount = { month: string; amount: number };

/** `total` and `previous` are positive when money went out. */
export type SpendingLine = { name: string; total: number; previous: number };
export type SpendingGroup = SpendingLine & { categories: SpendingLine[] };

/** `total` is positive when money goes out. */
export type AmountLine = { name: string; total: number };
export type AmountGroup = AmountLine & { categories: AmountLine[] };

export type IncomeLine = { name: string; total: number; previous: number };

export type Receipt = {
  date: string;
  label: string;
  account: string;
  category: string | null;
  kind: 'income' | 'credit' | 'uncategorized';
  amount: number;
};

export type ReportAccount = {
  name: string;
  isCard: boolean;
  /** Money kept apart, not meant for this month's bills. */
  isSetAside: boolean;
  /** For a card, with the installments still to come, as banks report it. */
  balance: number;
  /** What the bank reports, when the account is linked to one. */
  bankReported: number | null;
  /** Balance minus what the bank reports. */
  bankDifference: number;
};

export type ReportTotals = {
  received: number;
  previousReceived: number;
  spent: number;
  previousSpent: number;
  /** Non-transfer money in that isn't income: refunds, repayments. */
  credits: number;
  uncategorizedInflow: number;
  toPay: number;
  paid: number;
  overdueCount: number;
  /** What can pay this month's bills. */
  cash: number;
  setAside: number;
  leftAfterBills: number;
};

export type ReportData = {
  generatedAt: string;
  today: string;
  month: string;
  previousMonth: string;
  totals: ReportTotals;
  pendingBills: PendingBill[];
  reminders: BillReminders;
  /** What's left to pay by category, card bills split into their charges. */
  toPayByCategory: AmountGroup[];
  billItems: BillItem[];
  cards: ReportCard[];
  dueByMonth: MonthAmount[];
  spending: SpendingGroup[];
  income: IncomeLine[];
  receipts: Receipt[];
  otherReceipts: { count: number; amount: number };
  accounts: ReportAccount[];
};

export type ReportCorrection = { description: string; count?: number };

export type ReportQuestion = {
  description: string;
  date?: string;
  amount?: number;
};

/** What the assistant that ran the day's cleanup has to say. */
export type ReportNotes = {
  summary?: string;
  corrections: ReportCorrection[];
  questions: ReportQuestion[];
};

export type DailyReport = ReportData & { notes: ReportNotes };
