import { normalizeDescription } from './installments';

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

/** Stable id. Not a secret and not a cryptographic hash. */
export function fingerprint(value: string): string {
  let hash = FNV_OFFSET;
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

export function billId(cardId: string, referenceMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(referenceMonth)) {
    throw new Error('reference month must be YYYY-MM');
  }
  return `${cardId}:${referenceMonth}`;
}

export function installmentId(purchaseId: string, number: number): string {
  if (!Number.isInteger(number) || number < 1) {
    throw new Error('installment number must be a positive integer');
  }
  return `${purchaseId}:${number}`;
}

export function importRecordId(
  provider: string,
  entityType: string,
  externalId: string,
): string {
  return fingerprint(`${provider}\0${entityType}\0${externalId}`);
}

export function purchaseFingerprint(purchase: {
  cardId: string;
  purchaseDate: string;
  totalAmount: number;
  installmentCount: number;
  description: string;
}): string {
  return fingerprint(
    [
      purchase.cardId,
      purchase.purchaseDate,
      String(purchase.totalAmount),
      String(purchase.installmentCount),
      normalizeDescription(purchase.description),
    ].join('\0'),
  );
}
