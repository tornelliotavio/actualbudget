export type ReportBillStatus =
  | 'overdue'
  | 'due'
  | 'upcoming'
  | 'open'
  | 'scheduled';

/** A bill still to pay this month, in positive cents. */
export type PendingBill = {
  name: string;
  dueDate: string;
  amount: number;
  kind: 'card' | 'schedule';
  isEstimate: boolean;
  status: ReportBillStatus;
};

/** The bill a card is on now. */
export type ReportCard = {
  name: string;
  referenceMonth: string;
  dueDate: string;
  status: string;
  total: number;
  paid: number;
  due: number;
  limitTotal: number | null;
  limitUsed: number | null;
};

export type MonthAmount = { month: string; amount: number };

/** `total` and `previous` are positive when money went out. */
export type SpendingLine = { name: string; total: number; previous: number };
export type SpendingGroup = SpendingLine & { categories: SpendingLine[] };

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
