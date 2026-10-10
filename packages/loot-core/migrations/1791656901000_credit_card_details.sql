BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS credit_card_bills (
  id TEXT PRIMARY KEY,
  card_id TEXT,
  reference_month TEXT,
  cycle_start TEXT,
  cycle_end TEXT,
  closing_date TEXT,
  due_date TEXT,
  confirmed_total INTEGER,
  minimum_payment INTEGER,
  source TEXT,
  provider_bill_id TEXT,
  last_confirmed_at TEXT,
  cancelled INTEGER DEFAULT 0,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_credit_card_bills_card ON credit_card_bills (card_id);

CREATE TABLE IF NOT EXISTS credit_card_purchases (
  id TEXT PRIMARY KEY,
  card_id TEXT,
  purchase_date TEXT,
  merchant TEXT,
  description TEXT,
  total_amount INTEGER,
  installment_count INTEGER,
  category_id TEXT,
  provider_purchase_key TEXT,
  source TEXT,
  status TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_credit_card_purchases_card ON credit_card_purchases (card_id);

CREATE TABLE IF NOT EXISTS credit_card_installments (
  id TEXT PRIMARY KEY,
  purchase_id TEXT,
  card_id TEXT,
  installment_number INTEGER,
  total_installments INTEGER,
  amount INTEGER,
  bill_id_override TEXT,
  transaction_id TEXT,
  provider_transaction_id TEXT,
  status TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_credit_card_installments_purchase
  ON credit_card_installments (purchase_id);
CREATE INDEX IF NOT EXISTS idx_credit_card_installments_transaction
  ON credit_card_installments (transaction_id);

CREATE TABLE IF NOT EXISTS credit_card_transaction_links (
  id TEXT PRIMARY KEY,
  transaction_id TEXT,
  card_id TEXT,
  bill_id TEXT,
  kind TEXT,
  source TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_credit_card_links_card
  ON credit_card_transaction_links (card_id);

CREATE TABLE IF NOT EXISTS credit_card_payments (
  id TEXT PRIMARY KEY,
  card_id TEXT,
  bill_id TEXT,
  transaction_id TEXT,
  bank_transaction_id TEXT,
  amount INTEGER,
  payment_date TEXT,
  source TEXT,
  status TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_credit_card_payments_card ON credit_card_payments (card_id);
CREATE INDEX IF NOT EXISTS idx_credit_card_payments_bill ON credit_card_payments (bill_id);

CREATE TABLE IF NOT EXISTS credit_card_import_records (
  id TEXT PRIMARY KEY,
  provider TEXT,
  entity_type TEXT,
  external_id TEXT,
  fingerprint TEXT,
  local_entity_id TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  payload_hash TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS credit_card_review_items (
  id TEXT PRIMARY KEY,
  card_id TEXT,
  kind TEXT,
  subject_id TEXT,
  candidates TEXT,
  status TEXT,
  resolution TEXT,
  created_at TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_credit_card_review_card ON credit_card_review_items (card_id);

COMMIT;
