import type { ProviderMetadata } from './types';

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      return asRecord(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asDate(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Read installment and bill ids out of the flattened Pluggy payload Actual
 * stores on `transactions.raw_synced_data`. Missing fields stay null.
 */
export function readCardMetadata(raw: unknown): ProviderMetadata | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const metadata: ProviderMetadata = {
    billId: asString(record['creditCardMetadata.billId']),
    installmentNumber: asNumber(record['creditCardMetadata.installmentNumber']),
    totalInstallments: asNumber(record['creditCardMetadata.totalInstallments']),
    purchaseDate: asDate(record['creditCardMetadata.purchaseDate']),
    totalAmount: asNumber(record['creditCardMetadata.totalAmount']),
    originalDate: asDate(record.originalDate),
  };
  const hasAny = Object.values(metadata).some(value => value != null);
  return hasAny ? metadata : null;
}
