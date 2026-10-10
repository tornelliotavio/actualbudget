import * as db from '#server/db';

import { assertCycleConfig } from './engine';
import type { ClosingDayPolicy } from './engine';

export type LimitSource = 'bank' | 'manual';
export type CardProvider = 'pluggyai' | 'manual';

export type CreditCard = {
  id: string;
  accountId: string;
  name: string;
  institution: string | null;
  provider: CardProvider;
  providerAccountId: string | null;
  closingDay: number;
  dueDay: number;
  closingDayPolicy: ClosingDayPolicy;
  timezone: string;
  creditLimit: number | null;
  creditLimitSource: LimitSource | null;
  availableLimit: number | null;
  availableLimitSource: LimitSource | null;
  limitUpdatedAt: string | null;
  parentCardId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreditCardDraft = {
  accountId: string;
  name: string;
  institution?: string | null;
  provider?: CardProvider;
  providerAccountId?: string | null;
  closingDay: number;
  dueDay: number;
  closingDayPolicy?: ClosingDayPolicy;
  timezone?: string;
  creditLimit?: number | null;
  creditLimitSource?: LimitSource | null;
  availableLimit?: number | null;
  availableLimitSource?: LimitSource | null;
  parentCardId?: string | null;
};

type CreditCardRow = {
  id: string;
  account_id: string | null;
  name: string | null;
  institution: string | null;
  provider: string | null;
  provider_account_id: string | null;
  closing_day: number | null;
  due_day: number | null;
  closing_day_policy: string | null;
  timezone: string | null;
  credit_limit: number | null;
  credit_limit_source: string | null;
  available_limit: number | null;
  available_limit_source: string | null;
  limit_updated_at: string | null;
  parent_card_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  tombstone: number | null;
};

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function nowIso(): string {
  return new Date(Date.now()).toISOString();
}

function asPolicy(value: string | null): ClosingDayPolicy {
  return value === 'current' ? 'current' : 'next';
}

function asProvider(value: string | null): CardProvider {
  return value === 'pluggyai' ? 'pluggyai' : 'manual';
}

function asLimitSource(value: string | null): LimitSource | null {
  if (value === 'bank' || value === 'manual') {
    return value;
  }
  return null;
}

export function toCreditCard(row: CreditCardRow): CreditCard {
  return {
    id: row.id,
    accountId: row.account_id ?? '',
    name: row.name ?? '',
    institution: row.institution,
    provider: asProvider(row.provider),
    providerAccountId: row.provider_account_id,
    closingDay: row.closing_day ?? 1,
    dueDay: row.due_day ?? 1,
    closingDayPolicy: asPolicy(row.closing_day_policy),
    timezone: row.timezone ?? DEFAULT_TIMEZONE,
    creditLimit: row.credit_limit,
    creditLimitSource: asLimitSource(row.credit_limit_source),
    availableLimit: row.available_limit,
    availableLimitSource: asLimitSource(row.available_limit_source),
    limitUpdatedAt: row.limit_updated_at,
    parentCardId: row.parent_card_id,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

export async function listCreditCardRows(): Promise<CreditCard[]> {
  const rows = await db.all<CreditCardRow>(
    'SELECT * FROM credit_cards WHERE tombstone = 0 ORDER BY name',
  );
  return rows.map(toCreditCard);
}

export async function getCreditCardRow(id: string): Promise<CreditCard | null> {
  const row = await db.first<CreditCardRow>(
    'SELECT * FROM credit_cards WHERE id = ? AND tombstone = 0',
    [id],
  );
  return row ? toCreditCard(row) : null;
}

export async function findCreditCardByAccount(
  accountId: string,
): Promise<CreditCard | null> {
  const row = await db.first<CreditCardRow>(
    'SELECT * FROM credit_cards WHERE account_id = ? AND tombstone = 0',
    [accountId],
  );
  return row ? toCreditCard(row) : null;
}

function validateDraft(draft: CreditCardDraft): string | null {
  if (!draft.accountId) {
    return 'account-required';
  }
  if (!draft.name?.trim()) {
    return 'name-required';
  }
  try {
    assertCycleConfig({
      closingDay: draft.closingDay,
      dueDay: draft.dueDay,
      closingDayPolicy: draft.closingDayPolicy ?? 'next',
    });
  } catch {
    return 'invalid-cycle';
  }
  if (
    draft.creditLimit != null &&
    (!Number.isInteger(draft.creditLimit) || draft.creditLimit < 0)
  ) {
    return 'invalid-limit';
  }
  if (
    draft.availableLimit != null &&
    (!Number.isInteger(draft.availableLimit) || draft.availableLimit < 0)
  ) {
    return 'invalid-limit';
  }
  return null;
}

export async function insertCreditCard(
  draft: CreditCardDraft,
): Promise<CreditCard | { error: string }> {
  const invalid = validateDraft(draft);
  if (invalid) {
    return { error: invalid };
  }
  const account = await db.first<{ id: string }>(
    'SELECT id FROM accounts WHERE id = ? AND tombstone = 0',
    [draft.accountId],
  );
  if (!account) {
    return { error: 'unknown-account' };
  }
  const existing = await findCreditCardByAccount(draft.accountId);
  if (existing) {
    return updateCreditCard(existing.id, draft);
  }

  const timestamp = nowIso();
  const id = await db.insertWithUUID('credit_cards', {
    account_id: draft.accountId,
    name: draft.name.trim(),
    institution: draft.institution ?? null,
    provider: draft.provider ?? 'manual',
    provider_account_id: draft.providerAccountId ?? null,
    closing_day: draft.closingDay,
    due_day: draft.dueDay,
    closing_day_policy: draft.closingDayPolicy ?? 'next',
    timezone: draft.timezone ?? DEFAULT_TIMEZONE,
    credit_limit: draft.creditLimit ?? null,
    credit_limit_source: draft.creditLimitSource ?? null,
    available_limit: draft.availableLimit ?? null,
    available_limit_source: draft.availableLimitSource ?? null,
    limit_updated_at:
      draft.creditLimit != null || draft.availableLimit != null
        ? timestamp
        : null,
    parent_card_id: draft.parentCardId ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    tombstone: 0,
  });
  const created = await getCreditCardRow(id);
  if (!created) {
    return { error: 'not-created' };
  }
  return created;
}

export async function updateCreditCard(
  id: string,
  patch: Partial<CreditCardDraft>,
): Promise<CreditCard | { error: string }> {
  const current = await getCreditCardRow(id);
  if (!current) {
    return { error: 'not-found' };
  }
  const next = {
    accountId: patch.accountId ?? current.accountId,
    name: patch.name ?? current.name,
    closingDay: patch.closingDay ?? current.closingDay,
    dueDay: patch.dueDay ?? current.dueDay,
    closingDayPolicy: patch.closingDayPolicy ?? current.closingDayPolicy,
    creditLimit:
      patch.creditLimit === undefined ? current.creditLimit : patch.creditLimit,
    availableLimit:
      patch.availableLimit === undefined
        ? current.availableLimit
        : patch.availableLimit,
  };
  const invalid = validateDraft(next);
  if (invalid) {
    return { error: invalid };
  }

  const timestamp = nowIso();
  const limitTouched =
    patch.creditLimit !== undefined || patch.availableLimit !== undefined;
  await db.update('credit_cards', {
    id,
    ...(patch.accountId !== undefined ? { account_id: patch.accountId } : {}),
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.institution !== undefined
      ? { institution: patch.institution }
      : {}),
    ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
    ...(patch.providerAccountId !== undefined
      ? { provider_account_id: patch.providerAccountId }
      : {}),
    ...(patch.closingDay !== undefined
      ? { closing_day: patch.closingDay }
      : {}),
    ...(patch.dueDay !== undefined ? { due_day: patch.dueDay } : {}),
    ...(patch.closingDayPolicy !== undefined
      ? { closing_day_policy: patch.closingDayPolicy }
      : {}),
    ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
    ...(patch.creditLimit !== undefined
      ? { credit_limit: patch.creditLimit }
      : {}),
    ...(patch.creditLimitSource !== undefined
      ? { credit_limit_source: patch.creditLimitSource }
      : {}),
    ...(patch.availableLimit !== undefined
      ? { available_limit: patch.availableLimit }
      : {}),
    ...(patch.availableLimitSource !== undefined
      ? { available_limit_source: patch.availableLimitSource }
      : {}),
    ...(limitTouched ? { limit_updated_at: timestamp } : {}),
    ...(patch.parentCardId !== undefined
      ? { parent_card_id: patch.parentCardId }
      : {}),
    updated_at: timestamp,
  });
  const updated = await getCreditCardRow(id);
  if (!updated) {
    return { error: 'not-found' };
  }
  return updated;
}

export async function deleteCreditCard(id: string): Promise<{ id: string }> {
  await db.delete_('credit_cards', id);
  return { id };
}

export function isCreditCardError(
  value: CreditCard | { error: string },
): value is { error: string } {
  return 'error' in value;
}
