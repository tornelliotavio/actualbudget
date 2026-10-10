import * as db from '#server/db';

export const CREDIT_CARDS_SCHEMA_VERSION = 1;

const PREF_ID = 'credit-cards-schema-version';

export async function creditCardsAccess(): Promise<{
  schemaVersion: number;
  supportedVersion: number;
  readOnly: boolean;
}> {
  const row = await db.first<{ value: string | null }>(
    'SELECT value FROM preferences WHERE id = ?',
    [PREF_ID],
  );
  const parsed = Number(row?.value ?? 0);
  const schemaVersion = Number.isFinite(parsed) ? parsed : 0;
  return {
    schemaVersion,
    supportedVersion: CREDIT_CARDS_SCHEMA_VERSION,
    readOnly: schemaVersion > CREDIT_CARDS_SCHEMA_VERSION,
  };
}

/** Refuse writes from a build older than the budget's schema. */
export async function assertCreditCardsWritable(): Promise<{
  error: string;
} | null> {
  const access = await creditCardsAccess();
  if (access.readOnly) {
    return { error: 'upgrade-required' };
  }
  if (access.schemaVersion < CREDIT_CARDS_SCHEMA_VERSION) {
    await db.update('preferences', {
      id: PREF_ID,
      value: String(CREDIT_CARDS_SCHEMA_VERSION),
    });
  }
  return null;
}
