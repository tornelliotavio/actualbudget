import { createApp } from '#server/app';
import { mutator } from '#server/mutators';
import { undoable } from '#server/undo';

import {
  deleteCreditCard,
  getCreditCardRow,
  insertCreditCard,
  listCreditCardRows,
  updateCreditCard,
} from './cards';
import type { CreditCard, CreditCardDraft } from './cards';

export type CreditCardsHandlers = {
  'credit-cards-list': typeof listCards;
  'credit-cards-get': typeof getCard;
  'credit-cards-create': typeof createCard;
  'credit-cards-update': typeof updateCard;
  'credit-cards-delete': typeof removeCard;
};

async function listCards(): Promise<CreditCard[]> {
  return listCreditCardRows();
}

async function getCard({
  id,
}: {
  id: string;
}): Promise<CreditCard | { error: string }> {
  const card = await getCreditCardRow(id);
  if (!card) {
    return { error: 'not-found' };
  }
  return card;
}

async function createCard(
  draft: CreditCardDraft,
): Promise<CreditCard | { error: string }> {
  return insertCreditCard(draft);
}

async function updateCard({
  id,
  ...patch
}: { id: string } & Partial<CreditCardDraft>): Promise<
  CreditCard | { error: string }
> {
  return updateCreditCard(id, patch);
}

async function removeCard({ id }: { id: string }): Promise<{ id: string }> {
  return deleteCreditCard(id);
}

export const app = createApp<CreditCardsHandlers>();
app.method('credit-cards-list', listCards);
app.method('credit-cards-get', getCard);
app.method('credit-cards-create', mutator(undoable(createCard)));
app.method('credit-cards-update', mutator(undoable(updateCard)));
app.method('credit-cards-delete', mutator(undoable(removeCard)));
