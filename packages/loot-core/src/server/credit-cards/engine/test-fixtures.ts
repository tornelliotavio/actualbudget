import type { CardEntry, ProviderFacts, StoredCardFields } from './types';

const emptyStored: StoredCardFields = {
  bill: null,
  billSource: null,
  kind: null,
  purchaseId: null,
  installmentNumber: null,
  installmentCount: null,
};

const emptyProvider: ProviderFacts = {
  billId: null,
  installment: null,
  purchaseDate: null,
  totalAmount: null,
  cardLast4: null,
  operationType: null,
  feeType: null,
  otherCreditsType: null,
  pending: false,
};

export function cardEntry(
  fields: Partial<Omit<CardEntry, 'provider' | 'stored'>> & {
    id: string;
    date: string;
    amount: number;
    provider?: Partial<ProviderFacts> | null;
    stored?: Partial<StoredCardFields>;
  },
): CardEntry {
  return {
    importedId: null,
    projected: false,
    isTransfer: false,
    description: '',
    ...fields,
    provider:
      fields.provider === null
        ? null
        : { ...emptyProvider, ...(fields.provider ?? {}) },
    stored: { ...emptyStored, ...(fields.stored ?? {}) },
  };
}
