import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { runMutator } from '#server/mutators';

import { linkTransfers } from './transfer-links';

const MEI = 'inter-mei';
const PF = 'inter-pf';
const CARD = 'cartao-inter';
const TODAY = '2026-10-14';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  for (const [id, name] of [
    [MEI, 'Inter MEI'],
    [PF, 'Inter PF'],
    [CARD, 'Cartão Inter PF'],
  ]) {
    await db.insertAccount({ id, name });
    await db.insertPayee({ id: `to-${id}`, name: '', transfer_acct: id });
  }
  await db.update('accounts', { id: CARD, kind: 'credit_card' });
});

function imported(fields: { id: string } & Record<string, unknown>) {
  return db.insertTransaction({
    cleared: true,
    imported_id: `bank-${fields.id}`,
    ...fields,
  });
}

function row(id: string) {
  return db.first<{
    transferred_id: string | null;
    description: string | null;
    category: string | null;
    tombstone: number;
  }>(
    'SELECT transferred_id, description, category, tombstone FROM transactions WHERE id = ?',
    [id],
  );
}

describe('linkTransfers', () => {
  // Inter MEI and Inter PF on 2026-10-10 in the 2026-10-14 export.
  it('links a Pix between two own accounts and merges a scheduled bill payment', async () => {
    await runMutator(async () => {
      await imported({
        id: 'pix-out',
        account: MEI,
        date: '2026-10-10',
        amount: -94825,
        notes: 'Pix enviado  - Otavio Tornelli Duarte',
      });
      await imported({
        id: 'pix-in',
        account: PF,
        date: '2026-10-10',
        amount: 94825,
        notes: 'Pix recebido - 58669481 Otavio Tornelli Duarte',
      });
      await imported({
        id: 'bill-debit',
        account: PF,
        date: '2026-10-10',
        amount: -94825,
        notes: 'Pagamento efetuado - Pagamento Fatura - OTAVIO TORNELLI DUARTE',
      });
      // Posted by the "Pagar fatura" schedule.
      await db.insertTransaction({
        id: 'scheduled',
        account: PF,
        date: '2026-10-10',
        amount: -94825,
        payee: `to-${CARD}`,
        transfer_id: 'scheduled-card',
      });
      await db.insertTransaction({
        id: 'scheduled-card',
        account: CARD,
        date: '2026-10-10',
        amount: 94825,
        payee: `to-${PF}`,
        transfer_id: 'scheduled',
      });
    });

    expect(await runMutator(() => linkTransfers({ today: TODAY }))).toEqual({
      merged: 1,
      linked: 1,
    });

    expect(await row('pix-out')).toMatchObject({ transferred_id: 'pix-in' });
    expect(await row('pix-in')).toMatchObject({ transferred_id: 'pix-out' });
    expect(await row('scheduled')).toMatchObject({ tombstone: 1 });
    expect(await row('bill-debit')).toMatchObject({
      transferred_id: 'scheduled-card',
      tombstone: 0,
    });
    expect(await row('scheduled-card')).toMatchObject({
      transferred_id: 'bill-debit',
    });

    expect(await runMutator(() => linkTransfers({ today: TODAY }))).toEqual({
      merged: 0,
      linked: 0,
    });
  });

  it('leaves movements with more than one possible other side', async () => {
    await runMutator(async () => {
      await imported({
        id: 'out',
        account: MEI,
        date: '2026-10-10',
        amount: -10000,
        notes: 'Pix enviado',
      });
      await imported({
        id: 'in-a',
        account: PF,
        date: '2026-10-10',
        amount: 10000,
        notes: 'Pix recebido',
      });
      await imported({
        id: 'in-b',
        account: PF,
        date: '2026-10-11',
        amount: 10000,
        notes: 'Pix recebido',
      });
    });

    expect(await runMutator(() => linkTransfers({ today: TODAY }))).toEqual({
      merged: 0,
      linked: 0,
    });
    expect(await row('out')).toMatchObject({ transferred_id: null });
  });

  it('leaves movements that are not transfers or were already categorized', async () => {
    const group = await db.insertCategoryGroup({ name: 'Casa' });
    const category = await db.insertCategory({
      name: 'Aluguel',
      cat_group: group,
    });
    await runMutator(async () => {
      await imported({
        id: 'rent',
        account: MEI,
        date: '2026-10-10',
        amount: -10000,
        notes: 'Pix enviado',
        category,
      });
      await imported({
        id: 'refund',
        account: PF,
        date: '2026-10-10',
        amount: 10000,
        notes: 'Pix recebido',
      });
      await imported({
        id: 'shop',
        account: MEI,
        date: '2026-10-11',
        amount: -5000,
        notes: 'Compra no débito - Mercado',
      });
      await imported({
        id: 'salary',
        account: PF,
        date: '2026-10-11',
        amount: 5000,
        notes: 'Crédito salário',
      });
    });

    expect(await runMutator(() => linkTransfers({ today: TODAY }))).toEqual({
      merged: 0,
      linked: 0,
    });
    expect(await row('rent')).toMatchObject({
      transferred_id: null,
      category,
    });
  });
});
