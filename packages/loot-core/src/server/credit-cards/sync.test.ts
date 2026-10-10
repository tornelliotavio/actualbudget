import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Timestamp } from '@actual-app/crdt';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as sqlite from '#platform/server/sqlite';
import * as db from '#server/db';
import * as prefs from '#server/prefs';
import { applyMessages, fullSync, setSyncingMode } from '#server/sync';
import { replayPendingMessages } from '#server/sync/replay';
import * as mockSyncServer from '#server/tests/mockSyncServer';

import { app } from './app';
import { isCreditCardError } from './cards';

type TestGlobals = typeof globalThis & {
  emptyDatabase: (avoidUpdate?: boolean) => () => Promise<void>;
  resetTime: () => void;
  stepForwardInTime: (time?: number) => void;
};

function testGlobals(): TestGlobals {
  return globalThis as TestGlobals;
}

function sendTimestamp(): Timestamp {
  const timestamp = Timestamp.send();
  if (timestamp == null) {
    throw new Error('Timestamp.send() returned null');
  }
  return timestamp;
}

function assertSynced(result: Awaited<ReturnType<typeof fullSync>>): void {
  if (result == null) {
    throw new Error('sync failed');
  }
  if (!('messages' in result)) {
    throw new Error(result.error.message);
  }
}

beforeEach(async () => {
  mockSyncServer.reset();
  setSyncingMode('enabled');
  await testGlobals().emptyDatabase()();
  await prefs.loadPrefs();
  await prefs.savePrefs({ groupId: 'group' });
});

afterEach(() => {
  testGlobals().resetTime();
  setSyncingMode('disabled');
});

async function createCard(name = 'Inter') {
  const accountId = await db.insertAccount({
    name: 'Inter Card',
    offbudget: 0,
  });
  const card = await app.handlers['credit-cards-create']({
    accountId,
    name,
    closingDay: 10,
    dueDay: 17,
  });
  if (isCreditCardError(card)) {
    throw new Error(card.error);
  }
  return card;
}

describe('credit card sync', () => {
  it('reappears on a second client that syncs the same budget', async () => {
    const card = await createCard();
    assertSynced(await fullSync());
    expect(mockSyncServer.getMessages().length).toBeGreaterThan(0);

    await testGlobals().emptyDatabase()();
    setSyncingMode('enabled');
    await prefs.loadPrefs();
    await prefs.savePrefs({
      groupId: 'group',
      lastSyncedTimestamp: Timestamp.zero.toString(),
    });

    assertSynced(await fullSync());
    const cards = await app.handlers['credit-cards-list']();
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(card.id);
    expect(cards[0].name).toBe('Inter');
    expect(cards[0].closingDay).toBe(10);

    assertSynced(await fullSync());
    expect(await app.handlers['credit-cards-list']()).toHaveLength(1);
  });

  it('keeps the later write when two clients edit the same cell', async () => {
    const card = await createCard();
    testGlobals().stepForwardInTime();
    await applyMessages(
      [
        {
          dataset: 'credit_cards',
          row: card.id,
          column: 'name',
          value: 'Inter from phone',
          timestamp: sendTimestamp(),
        },
      ],
      true,
    );
    const stored = await app.handlers['credit-cards-get']({ id: card.id });
    if (isCreditCardError(stored)) {
      throw new Error(stored.error);
    }
    expect(stored.name).toBe('Inter from phone');
    expect(stored.closingDay).toBe(10);
    expect(stored.dueDay).toBe(17);
  });

  it('syncs a deletion as a tombstone', async () => {
    const card = await createCard();
    await app.handlers['credit-cards-delete']({ id: card.id });
    await testGlobals().emptyDatabase()();
    setSyncingMode('enabled');
    await prefs.loadPrefs();
    await prefs.savePrefs({
      groupId: 'group',
      lastSyncedTimestamp: Timestamp.zero.toString(),
    });
    assertSynced(await fullSync());
    expect(await app.handlers['credit-cards-list']()).toEqual([]);
    const row = await db.first<{ tombstone: number }>(
      'SELECT tombstone FROM credit_cards WHERE id = ?',
      [card.id],
    );
    expect(row?.tombstone).toBe(1);
  });

  it('defers a card written by a newer schema and replays it after migrating', async () => {
    db.execQuery('DROP TABLE credit_cards');
    await applyMessages(
      [
        {
          dataset: 'credit_cards',
          row: 'card-1',
          column: 'name',
          value: 'Renner',
          timestamp: sendTimestamp(),
        },
        {
          dataset: 'credit_cards',
          row: 'card-1',
          column: 'closing_day',
          value: 5,
          timestamp: sendTimestamp(),
        },
      ],
      true,
    );
    const pending = db.runQuery<{ dataset: string }>(
      'SELECT dataset FROM messages_pending WHERE dataset = ?',
      ['credit_cards'],
      true,
    );
    expect(pending.length).toBe(2);

    db.execQuery(`
      CREATE TABLE credit_cards (
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
      )
    `);
    replayPendingMessages();
    const row = await db.first<{ name: string; closing_day: number }>(
      'SELECT name, closing_day FROM credit_cards WHERE id = ?',
      ['card-1'],
    );
    expect(row).toEqual({ name: 'Renner', closing_day: 5 });
  });

  it('survives a database export and reopen', async () => {
    await createCard('Itaú');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actual-credit-cards-'));
    const previous = process.env.ACTUAL_DATA_DIR;
    process.env.ACTUAL_DATA_DIR = dir;
    try {
      const database = db.getDatabase();
      if (database == null) {
        throw new Error('no database');
      }
      const exported = await sqlite.exportDatabase(database);
      // Node tests run the Electron sqlite binding, whose open is synchronous.
      // The typecheck target is the shared signature, which does not say so.
      type SqliteDatabase = Parameters<typeof sqlite.closeDatabase>[0];
      const copy = sqlite.openDatabase(
        Buffer.from(exported),
      ) as unknown as SqliteDatabase;
      const rows = sqlite.runQuery(
        copy,
        'SELECT name FROM credit_cards WHERE tombstone = 0',
        [],
        true,
      ) as unknown as Array<{ name: string }>;
      sqlite.closeDatabase(copy);
      expect(rows.map(row => row.name)).toEqual(['Itaú']);
    } finally {
      if (previous === undefined) {
        delete process.env.ACTUAL_DATA_DIR;
      } else {
        process.env.ACTUAL_DATA_DIR = previous;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
