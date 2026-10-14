import type { IntegerAmount } from '#shared/util';

import type { AccountEntity } from './account';
import type { CategoryEntity } from './category';
import type {
  CardBillEntity,
  CardBillSource,
  CardEntryKind,
  CardPurchaseEntity,
} from './credit-card';
import type { PayeeEntity } from './payee';
import type { ScheduleEntity } from './schedule';

export type TransactionEntity = {
  id: string;
  is_parent?: boolean;
  is_child?: boolean;
  parent_id?: TransactionEntity['id'];
  account: AccountEntity['id'];
  category?: CategoryEntity['id'];
  amount: IntegerAmount;
  payee?: PayeeEntity['id'] | null;
  notes?: string;
  date: string;
  imported_id?: string;
  imported_payee?: string;
  starting_balance_flag?: boolean;
  transfer_id?: TransactionEntity['id'];
  sort_order?: number;
  cleared?: boolean;
  reconciled?: boolean;
  tombstone?: boolean;
  forceUpcoming?: boolean;
  schedule?: ScheduleEntity['id'];
  subtransactions?: TransactionEntity[];
  _unmatched?: boolean;
  _deleted?: boolean;
  error?: {
    type: 'SplitTransactionError';
    version: 1;
    difference: number;
  } | null;
  raw_synced_data?: string | undefined;
  card_bill?: CardBillEntity['id'] | null;
  card_bill_source?: CardBillSource | null;
  card_kind?: CardEntryKind | null;
  card_purchase?: CardPurchaseEntity['id'] | null;
  installment_number?: number | null;
  installment_count?: number | null;
  projected?: boolean;
  budget_date?: string | null;
  bank_sync_missing_since?: string | null;
  _ruleErrors?: string[];
};
