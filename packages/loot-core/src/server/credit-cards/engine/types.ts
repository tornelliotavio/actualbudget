/** `YYYY-MM-DD` */
export type DateString = string;
/** `YYYY-MM` */
export type MonthString = string;
/** Integer cents, signed like Actual transactions: a purchase is negative. */
export type Cents = number;

export type ClosingRule =
  | { kind: 'fixed_day'; day: number }
  | { kind: 'days_before_due'; days: number };

export type CardSchedule = {
  closing: ClosingRule;
  dueDay: number;
  /** A purchase dated on the closing day belongs to the following bill. */
  closingDayInNextBill: boolean;
};

export type BillDatesSource = 'computed' | 'provider' | 'user';

/** Dates a bill row stores because the bank or the user stated them. */
export type BillDateOverride = {
  referenceMonth: MonthString;
  closingDate: DateString | null;
  dueDate: DateString | null;
  source: Exclude<BillDatesSource, 'computed'>;
};

export type BillPeriod = {
  /** Month of the nominal due date: "the October bill" is due in October. */
  referenceMonth: MonthString;
  /** First day whose charges belong to this bill. */
  startDate: DateString;
  /** Last day whose charges belong to this bill. */
  endDate: DateString;
  closingDate: DateString;
  dueDate: DateString;
  /** Due date moved to the next banking day. */
  effectiveDueDate: DateString;
  /** Due date used for budgeting; always inside `referenceMonth`. */
  budgetDate: DateString;
  datesSource: BillDatesSource;
};

export type InstallmentInfo = {
  number: number;
  count: number;
};

export type CardEntryKind =
  | 'purchase'
  | 'installment'
  | 'fee'
  | 'credit'
  | 'payment';

export type BillSource = 'user' | 'provider' | 'installment' | 'cycle';

/** What the bank said about a card transaction, normalized. */
export type ProviderFacts = {
  billId: string | null;
  /** Day the charge posted to a bill; on or before that bill's closing day. */
  postDate: DateString | null;
  installment: InstallmentInfo | null;
  purchaseDate: DateString | null;
  totalAmount: Cents | null;
  cardLast4: string | null;
  operationType: string | null;
  feeType: string | null;
  otherCreditsType: string | null;
  pending: boolean;
};

/** A transaction of a credit card account, as the engine sees it. */
export type CardEntry = {
  id: string;
  date: DateString;
  amount: Cents;
  importedId: string | null;
  projected: boolean;
  isTransfer: boolean;
  description: string;
  provider: ProviderFacts | null;
  stored: StoredCardFields;
};

/** Card columns already stored on the transaction. */
export type StoredCardFields = {
  bill: MonthString | null;
  billSource: BillSource | null;
  kind: CardEntryKind | null;
  purchaseId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
};

export type PurchaseStatus = 'active' | 'cancelled' | 'dismissed';

export type Purchase = {
  id: string;
  stem: string;
  installmentCount: number;
  /** Bill of the first installment. */
  anchorMonth: MonthString;
  cardLast4: string | null;
  purchaseDate: DateString | null;
  totalAmount: Cents | null;
  status: PurchaseStatus;
};

export type ProviderBill = {
  id: string;
  dueDate: DateString;
  closingDate: DateString | null;
  totalAmount: Cents;
  minimumPayment: Cents | null;
  financeCharges: Cents;
  payments: Array<{ id: string | null; date: DateString; amount: Cents }>;
};
