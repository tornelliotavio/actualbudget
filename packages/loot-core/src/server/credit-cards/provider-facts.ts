import { addMonths } from '#shared/months';

import { clampDay } from './engine/bill-calendar';
import { installmentFrom } from './engine/installments';
import type { DateString, ProviderFacts } from './engine/types';

type RawSyncedData = Record<string, unknown>;

const SAO_PAULO = 'America/Sao_Paulo';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function isoDay(value: unknown): DateString | null {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

/** Calendar day in Brazil of an instant, e.g. a purchase at 22:00 local time. */
export function saoPauloDay(instant: string): DateString | null {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SAO_PAULO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parts;
}

function shiftMonths(date: DateString, months: number): DateString {
  return clampDay(addMonths(date.slice(0, 7), months), Number(date.slice(8)));
}

export function parseRawSyncedData(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as RawSyncedData)
      : null;
  } catch {
    return null;
  }
}

/**
 * The date the bank reported, before Actual changed it. Older imports stored
 * a date already shifted by `installmentNumber - 1` months; `originalDate`
 * keeps the bank's value in both formats.
 */
export function providerDate(raw: RawSyncedData): DateString | null {
  const dateTime = text(raw['creditCardMetadata.transactionDateTime']);
  if (dateTime) {
    const local = saoPauloDay(dateTime);
    if (local) {
      return local;
    }
  }
  return isoDay(raw.originalDate) ?? isoDay(raw.date);
}

/**
 * Purchase date of an installment. Imports made before dates were kept in
 * `raw_synced_data` lost Pluggy's `purchaseDate`, but their stored `date`
 * was derived from it: `purchaseDate + (n - 1) months`, or from the bank date
 * when the purchase date was missing.
 */
function purchaseDate(raw: RawSyncedData, number: number | null) {
  const explicit = isoDay(raw['creditCardMetadata.purchaseDate']);
  if (explicit || number == null) {
    return explicit;
  }
  const original = isoDay(raw.originalDate);
  const stored = isoDay(raw.date);
  if (!original || !stored || original === stored) {
    return number === 1 ? (original ?? stored) : null;
  }
  if (stored === shiftMonths(original, number - 1)) {
    return null;
  }
  return shiftMonths(stored, -(number - 1));
}

export function providerFacts(raw: RawSyncedData): ProviderFacts {
  const installment = installmentFrom(
    numberOrNull(raw['creditCardMetadata.installmentNumber']),
    numberOrNull(raw['creditCardMetadata.totalInstallments']),
  );
  const total = numberOrNull(raw['creditCardMetadata.totalAmount']);
  const cardNumber = text(raw['creditCardMetadata.cardNumber']);
  return {
    billId: text(raw['creditCardMetadata.billId']),
    postDate: isoDay(raw['creditCardMetadata.billPostDate']),
    installment,
    purchaseDate: purchaseDate(raw, installment?.number ?? null),
    // Pluggy reports card amounts as positive charges.
    totalAmount: total == null ? null : -Math.round(Math.abs(total) * 100),
    cardLast4: cardNumber ? cardNumber.slice(-4) : null,
    operationType: text(raw.operationType),
    feeType: text(raw['creditCardMetadata.feeType']),
    otherCreditsType: text(raw['creditCardMetadata.otherCreditsType']),
    pending: raw.status === 'PENDING' || raw.booked === false,
  };
}
