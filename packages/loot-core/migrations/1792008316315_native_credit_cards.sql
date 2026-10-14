BEGIN TRANSACTION;

ALTER TABLE accounts ADD COLUMN kind TEXT DEFAULT 'standard';

ALTER TABLE transactions ADD COLUMN card_bill TEXT;
ALTER TABLE transactions ADD COLUMN card_bill_source TEXT;
ALTER TABLE transactions ADD COLUMN card_kind TEXT;
ALTER TABLE transactions ADD COLUMN card_purchase TEXT;
ALTER TABLE transactions ADD COLUMN installment_number INTEGER;
ALTER TABLE transactions ADD COLUMN installment_count INTEGER;
ALTER TABLE transactions ADD COLUMN projected INTEGER DEFAULT 0;
ALTER TABLE transactions ADD COLUMN budget_date INTEGER;
ALTER TABLE transactions ADD COLUMN bank_sync_missing_since INTEGER;

CREATE INDEX trans_card_bill ON transactions(card_bill);
CREATE INDEX trans_card_purchase ON transactions(card_purchase);
CREATE INDEX trans_budget_date ON transactions(budget_date);

CREATE TABLE card_profiles
  (id TEXT PRIMARY KEY,
   closing_rule TEXT,
   closing_day_provider INTEGER,
   closing_day_user INTEGER,
   closing_offset_user INTEGER,
   due_day_provider INTEGER,
   due_day_user INTEGER,
   closing_day_on_closing_bill INTEGER,
   credit_limit_user INTEGER,
   parent_account TEXT,
   connector TEXT,
   brand TEXT,
   holder_type TEXT,
   card_status TEXT,
   payment_patterns TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE TABLE card_bills
  (id TEXT PRIMARY KEY,
   account TEXT,
   reference_month TEXT,
   closing_date_provider INTEGER,
   due_date_provider INTEGER,
   closing_date_user INTEGER,
   due_date_user INTEGER,
   provider_bill_id TEXT,
   provider_total INTEGER,
   provider_minimum INTEGER,
   provider_finance_charges INTEGER,
   provider_payments TEXT,
   total_user INTEGER,
   tombstone INTEGER DEFAULT 0);

CREATE INDEX card_bills_account ON card_bills(account);

CREATE TABLE card_purchases
  (id TEXT PRIMARY KEY,
   account TEXT,
   stem TEXT,
   installment_count INTEGER,
   anchor_month TEXT,
   card_last4 TEXT,
   purchase_date INTEGER,
   total_amount INTEGER,
   status TEXT DEFAULT 'active',
   tombstone INTEGER DEFAULT 0);

CREATE INDEX card_purchases_account ON card_purchases(account);

CREATE TABLE bank_sync_suppressions
  (id TEXT PRIMARY KEY,
   account TEXT,
   imported_id TEXT,
   reason TEXT,
   tombstone INTEGER DEFAULT 0);

CREATE INDEX bank_sync_suppressions_account ON bank_sync_suppressions(account);

COMMIT;
