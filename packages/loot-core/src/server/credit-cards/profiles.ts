import * as db from '#server/db';
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
  await db.update('accounts', { id: accountId, kind: 'credit_card' });

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
    await db.updateWithSchema('card_profiles', {
      id: accountId,
      tombstone: false,
      ...Object.fromEntries(
        Object.entries(userFields).filter(([, value]) => value != null),
      ),
    });
    return;
  }

  await db.insertWithSchema('card_profiles', {
    id: accountId,
    ...userFields,
  });
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
      | 'closing_day_in_next_bill'
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
