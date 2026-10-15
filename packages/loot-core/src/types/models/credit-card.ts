import type { AccountEntity } from './account';

export type CardClosingRule = 'fixed_day' | 'days_before_due';

/** Where a card's bills come from: bank sync, or PDF statements. */
export type CardConnector = 'open_finance' | 'direct' | 'statement';

export type CardEntryKind =
  | 'purchase'
  | 'installment'
  | 'fee'
  | 'credit'
  | 'payment';

export type CardBillSource =
  | 'user'
  | 'provider'
  | 'installment'
  | 'cycle'
  | 'adjustment';

/** Settings of a credit card account; `id` is the account id. */
export type CardProfileEntity = {
  id: AccountEntity['id'];
  closing_rule: CardClosingRule | null;
  closing_day_provider: number | null;
  closing_day_user: number | null;
  closing_offset_user: number | null;
  due_day_provider: number | null;
  due_day_user: number | null;
  /** Purchases on the closing day stay on the closing bill (default: next bill). */
  closing_day_on_closing_bill: boolean | null;
  credit_limit_user: number | null;
  parent_account: AccountEntity['id'] | null;
  connector: CardConnector | null;
  brand: string | null;
  holder_type: string | null;
  card_status: string | null;
  payment_patterns: string | null;
  /**
   * Bills closing before this day are left without finance-charge
   * adjustments: the balance the account started with already covers them.
   */
  adjustments_from: string | null;
  tombstone?: boolean;
};

export type CardBillPayment = {
  id: string | null;
  date: string;
  amount: number;
};

/** What the bank or the user stated about one bill. */
export type CardBillEntity = {
  id: string;
  account: AccountEntity['id'];
  reference_month: string;
  closing_date_provider: string | null;
  due_date_provider: string | null;
  closing_date_user: string | null;
  due_date_user: string | null;
  provider_bill_id: string | null;
  provider_total: number | null;
  provider_minimum: number | null;
  provider_finance_charges: number | null;
  provider_payments: CardBillPayment[] | null;
  total_user: number | null;
  tombstone?: boolean;
};

/** See `PurchaseStatus` in the credit card engine. */
export type CardPurchaseStatus = 'active' | 'kept' | 'cancelled' | 'dismissed';

export type CardPurchaseEntity = {
  id: string;
  account: AccountEntity['id'];
  stem: string;
  installment_count: number;
  anchor_month: string;
  card_last4: string | null;
  purchase_date: string | null;
  total_amount: number | null;
  status: CardPurchaseStatus;
  tombstone?: boolean;
};
