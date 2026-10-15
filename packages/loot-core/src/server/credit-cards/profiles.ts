import * as db from '#server/db';
import { currentDay } from '#shared/months';
import type { AccountEntity, CardProfileEntity } from '#types/models';

export type CardSettingsInput = {
  closingDay?: number | null;
  dueDay?: number | null;
  creditLimit?: number | null;
};

function validDay(day: number | null | undefined): number | null {
  if (day == null) {
    return null;
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error('Card days must be integers from 1 to 31');
  }
  return day;
}

export async function getCardProfile(
  accountId: AccountEntity['id'],
): Promise<CardProfileEntity | null> {
  return db.selectFirstWithSchema(
    'card_profiles',
    'SELECT * FROM card_profiles WHERE id = ? AND tombstone = 0',
    [accountId],
  );
}

/**
 * Makes an account a credit card account. The profile row shares the account
 * id, so two devices doing this at once write the same row.
 */
export async function makeCreditCardAccount(
  accountId: AccountEntity['id'],
  settings: CardSettingsInput = {},
): Promise<void> {
  const account = await db.first<{ kind: string | null }>(
    'SELECT kind FROM accounts WHERE id = ?',
    [accountId],
  );
  if (account?.kind !== 'credit_card') {
    await db.update('accounts', { id: accountId, kind: 'credit_card' });
  }

  const existing = await db.first<{ id: string; tombstone: number }>(
    'SELECT id, tombstone FROM card_profiles WHERE id = ?',
    [accountId],
  );
  const userFields = {
    closing_day_user: validDay(settings.closingDay),
    due_day_user: validDay(settings.dueDay),
    credit_limit_user: settings.creditLimit ?? null,
  };

  if (existing) {
    const changes = Object.fromEntries(
      Object.entries(userFields).filter(([, value]) => value != null),
    );
    if (existing.tombstone || Object.keys(changes).length > 0) {
      await db.updateWithSchema('card_profiles', {
        id: accountId,
        tombstone: false,
        ...changes,
      });
    }
    return;
  }

  const legacy = await legacyCardDays(accountId);
  await db.insertWithSchema('card_profiles', {
    id: accountId,
    ...userFields,
    closing_day_provider: legacy?.closing_day ?? null,
    due_day_provider: legacy?.due_day ?? null,
    adjustments_from: currentDay(),
  });
}

/**
 * Makes a card account a regular account again. The profile is tombstoned
 * rather than deleted: it marks the account as one the user does not want as
 * a card, and turning it into a card again restores the user's settings.
 */
export async function makeStandardAccount(
  accountId: AccountEntity['id'],
): Promise<void> {
  await db.update('accounts', { id: accountId, kind: 'standard' });
  if (await getCardProfile(accountId)) {
    await db.updateWithSchema('card_profiles', {
      id: accountId,
      tombstone: true,
    });
  }
}

/** Whether the user turned this account from a card back into a regular one. */
export async function isCardDeclined(
  accountId: AccountEntity['id'],
): Promise<boolean> {
  const profile = await db.first<{ tombstone: number }>(
    'SELECT tombstone FROM card_profiles WHERE id = ?',
    [accountId],
  );
  return profile?.tombstone === 1;
}

/**
 * Billing days saved by the first credit card module, used until the bank
 * reports its own. Its `credit_card_*` tables are read-only leftovers.
 */
async function legacyCardDays(accountId: AccountEntity['id']) {
  const table = await db.first<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credit_cards'",
  );
  if (!table) {
    return null;
  }
  return db.first<{ closing_day: number | null; due_day: number | null }>(
    'SELECT closing_day, due_day FROM credit_cards WHERE account_id = ? AND tombstone = 0',
    [accountId],
  );
}

/** Changes the user overrides; `null` clears one, `undefined` keeps it. */
export async function updateCardSettings(
  accountId: AccountEntity['id'],
  fields: Partial<
    Pick<
      CardProfileEntity,
      | 'closing_rule'
      | 'closing_day_user'
      | 'closing_offset_user'
      | 'due_day_user'
      | 'closing_day_on_closing_bill'
      | 'credit_limit_user'
      | 'parent_account'
      | 'payment_patterns'
    >
  >,
): Promise<void> {
  if (fields.closing_day_user !== undefined) {
    validDay(fields.closing_day_user);
  }
  if (fields.due_day_user !== undefined) {
    validDay(fields.due_day_user);
  }
  if (
    fields.closing_offset_user != null &&
    (!Number.isInteger(fields.closing_offset_user) ||
      fields.closing_offset_user < 1 ||
      fields.closing_offset_user > 28)
  ) {
    throw new Error('Days before due must be an integer from 1 to 28');
  }
  const changes = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(changes).length === 0) {
    return;
  }
  await db.updateWithSchema('card_profiles', { id: accountId, ...changes });
}
