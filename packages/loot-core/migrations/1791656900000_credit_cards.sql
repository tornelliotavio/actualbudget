BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS credit_cards (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  name TEXT,
  institution TEXT,
  provider TEXT,
  provider_account_id TEXT,
  closing_day INTEGER,
  due_day INTEGER,
  closing_day_policy TEXT,
  timezone TEXT,
  credit_limit INTEGER,
  credit_limit_source TEXT,
  available_limit INTEGER,
  available_limit_source TEXT,
  limit_updated_at TEXT,
  parent_card_id TEXT,
  created_at TEXT,
  updated_at TEXT,
  tombstone INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_credit_cards_account ON credit_cards (account_id);
CREATE INDEX IF NOT EXISTS idx_credit_cards_tombstone ON credit_cards (tombstone);

COMMIT;
