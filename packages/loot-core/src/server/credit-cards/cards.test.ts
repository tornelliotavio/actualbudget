import { beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import { setSyncingMode } from '#server/sync';

import { app } from './app';
import { isCreditCardError } from './cards';

async function emptyDatabase(): Promise<void> {
  const globals = globalThis as typeof globalThis & {
    emptyDatabase: (avoidUpdate?: boolean) => () => Promise<void>;
  };
  await globals.emptyDatabase()();
}

beforeEach(async () => {
  setSyncingMode('disabled');
  await emptyDatabase();
});

async function account(): Promise<string> {
  return db.insertAccount({ name: 'Inter Card', offbudget: 0 });
}

const draft = {
  name: 'Inter',
  institution: 'Inter',
  closingDay: 10,
  dueDay: 17,
  creditLimit: 500000,
  creditLimitSource: 'manual' as const,
};

describe('credit card records', () => {
  it('creates, updates and deletes a card without touching transactions', async () => {
    const accountId = await account();
    const before = await db.all('SELECT id FROM transactions');

    const created = await app.handlers['credit-cards-create']({
      ...draft,
      accountId,
    });
    if (isCreditCardError(created)) {
      throw new Error(created.error);
    }
    expect(created).toMatchObject({
      accountId,
      name: 'Inter',
      provider: 'manual',
      closingDay: 10,
      dueDay: 17,
      closingDayPolicy: 'next',
      timezone: 'America/Sao_Paulo',
      creditLimit: 500000,
    });

    const updated = await app.handlers['credit-cards-update']({
      id: created.id,
      closingDayPolicy: 'current',
      availableLimit: 310000,
      availableLimitSource: 'bank',
    });
    if (isCreditCardError(updated)) {
      throw new Error(updated.error);
    }
    expect(updated.closingDayPolicy).toBe('current');
    expect(updated.availableLimit).toBe(310000);
    expect(updated.creditLimit).toBe(500000);

    await app.handlers['credit-cards-delete']({ id: created.id });
    expect(await app.handlers['credit-cards-list']()).toEqual([]);
    const row = await db.first<{ tombstone: number }>(
      'SELECT tombstone FROM credit_cards WHERE id = ?',
      [created.id],
    );
    expect(row?.tombstone).toBe(1);
    expect(await db.all('SELECT id FROM transactions')).toEqual(before);
  });

  it('returns the existing card when the same account is registered again', async () => {
    const accountId = await account();
    const first = await app.handlers['credit-cards-create']({
      ...draft,
      accountId,
    });
    const second = await app.handlers['credit-cards-create']({
      ...draft,
      accountId,
      name: 'Inter renamed',
    });
    if (isCreditCardError(first) || isCreditCardError(second)) {
      throw new Error('create failed');
    }
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Inter renamed');
    expect(await app.handlers['credit-cards-list']()).toHaveLength(1);
  });

  it('rejects a missing account and an impossible closing day', async () => {
    expect(
      await app.handlers['credit-cards-create']({
        ...draft,
        accountId: 'missing',
      }),
    ).toEqual({ error: 'unknown-account' });

    const accountId = await account();
    expect(
      await app.handlers['credit-cards-create']({
        ...draft,
        accountId,
        closingDay: 32,
      }),
    ).toEqual({ error: 'invalid-cycle' });
  });
});
