/** Integer cents. Bill, installment and payment figures are positive (owed or paid). */
export type Cents = number;

export type ClosingDayPolicy = 'current' | 'next';

export type DataSource = 'bank' | 'imported' | 'projected' | 'manual';

export type BillStatus =
  | 'open'
  | 'closed'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled';

export type InstallmentStatus =
  | 'projected'
  | 'imported'
  | 'confirmed'
  | 'cancelled'
  | 'reversed';

export type ChargeKind =
  | 'purchase'
  | 'installment'
  | 'fee'
  | 'interest'
  | 'refund'
  | 'adjustment'
  | 'carryover'
  | 'payment';

export type CycleConfig = {
  closingDay: number;
  dueDay: number;
  closingDayPolicy: ClosingDayPolicy;
};

export type Cycle = {
  cycleStart: string;
  cycleEnd: string;
  closingDate: string;
  dueDate: string;
  /** Due month, `YYYY-MM`. This is the bill's identity. */
  referenceMonth: string;
};

export type CycleOverride = {
  referenceMonth: string;
  cycleStart?: string | null;
  cycleEnd?: string | null;
  closingDate?: string | null;
  dueDate?: string | null;
};

export type ProviderMetadata = {
  billId: string | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  purchaseDate: string | null;
  /** Provider units (reais), not cents. */
  totalAmount: number | null;
  originalDate: string | null;
};

export type AssignableTransaction = {
  id: string;
  /** Actual's date, which bank sync may already have shifted. */
  date: string;
  originalDate?: string | null;
  /** Actual's sign: a purchase is negative. */
  amount: Cents;
  notes?: string | null;
  payeeName?: string | null;
  isTransfer: boolean;
  metadata?: ProviderMetadata | null;
};

export type AssignmentSource =
  | 'link'
  | 'provider'
  | 'original-date'
  | 'date'
  | 'unassigned';

export type Assignment = {
  billId: string | null;
  referenceMonth: string | null;
  source: AssignmentSource;
  kind: ChargeKind;
};

export type BillCharge = {
  id: string;
  /** Positive increases the amount owed. A refund is negative. */
  owedAmount: Cents;
  projected: boolean;
  kind: ChargeKind;
};

export type BillPayment = {
  id: string;
  amount: Cents;
  date: string;
};

export type BillInput = {
  id: string;
  referenceMonth: string;
  cycleStart: string;
  cycleEnd: string;
  closingDate: string;
  dueDate: string;
  confirmedTotal: Cents | null;
  minimumPayment: Cents | null;
  cancelled: boolean;
  charges: BillCharge[];
  payments: BillPayment[];
};

export type BillView = {
  id: string;
  referenceMonth: string;
  cycleStart: string;
  cycleEnd: string;
  closingDate: string;
  dueDate: string;
  confirmedTotal: Cents | null;
  minimumPayment: Cents | null;
  cancelled: boolean;
  computedTotal: Cents;
  projectedTotal: Cents;
  amountOwed: Cents;
  amountPaid: Cents;
  remaining: Cents;
  /** `confirmedTotal - computedTotal`, or null when the bank has not confirmed. */
  divergence: Cents | null;
  status: BillStatus;
};

export type CardSummary = {
  statement: BillView | null;
  openBill: BillView | null;
  currentBillAmount: Cents;
  amountDue: Cents;
  amountPaid: Cents;
  futureCommitments: Cents;
  totalCommitment: Cents;
  accountBalance: Cents;
  creditLimit: Cents | null;
  availableLimit: Cents | null;
};

export type PaymentAllocation = {
  billId: string;
  amount: Cents;
};

export type AllocationResult = {
  allocations: PaymentAllocation[];
  unallocated: Cents;
};
