import { descriptionStem, parseInstallmentLabel } from './installments';
import type { CardEntry, CardEntryKind, InstallmentInfo } from './types';

const PAYMENT_DESCRIPTIONS = [
  /\bPAGAMENTO (ON ?LINE|RECEBIDO|EFETUADO|DA FATURA|DE FATURA|FATURA)\b/,
  /\bPAGTO (DEBITO AUTOMATICO|FATURA|FAT)\b/,
  /\bPAG FATURA\b/,
  /\bDEBITO AUTOMATICO FATURA\b/,
];

const FEE_DESCRIPTIONS = [
  /\bIOF\b/,
  /\bANUIDADE\b/,
  /\bJUROS\b/,
  /\bENCARGOS?\b/,
  /\bMULTA\b/,
  /\bTARIFA\b/,
  /\bROTATIVO\b/,
];

/** Operation types that mark a bill payment regardless of description. */
const PAYMENT_OPERATIONS = new Set(['PAGAMENTO_FATURA']);
const FEE_OPERATIONS = new Set(['TARIFA', 'ENCARGO', 'ENCARGOS']);

export type ClassifyOptions = {
  /** Extra descriptions, already reduced with `descriptionStem`. */
  paymentStems?: string[];
  /** Whether a provider bill lists a payment matching this credit. */
  isProviderPayment?: (entry: CardEntry) => boolean;
};

export function entryInstallment(entry: CardEntry): InstallmentInfo | null {
  return (
    entry.provider?.installment ?? parseInstallmentLabel(entry.description)
  );
}

export function classifyEntry(
  entry: CardEntry,
  options: ClassifyOptions = {},
): CardEntryKind {
  const stem = descriptionStem(entry.description);
  const operation = entry.provider?.operationType ?? null;

  if (entry.amount > 0) {
    const isPayment =
      entry.isTransfer ||
      (operation != null && PAYMENT_OPERATIONS.has(operation)) ||
      PAYMENT_DESCRIPTIONS.some(pattern => pattern.test(stem)) ||
      (options.paymentStems ?? []).some(
        pattern => pattern.length > 0 && stem.includes(pattern),
      ) ||
      (options.isProviderPayment?.(entry) ?? false);
    return isPayment ? 'payment' : 'credit';
  }

  if (entryInstallment(entry)) {
    return 'installment';
  }
  const feeType = entry.provider?.feeType ?? null;
  if (
    (operation != null && FEE_OPERATIONS.has(operation)) ||
    (feeType != null && feeType !== 'OTHER') ||
    FEE_DESCRIPTIONS.some(pattern => pattern.test(stem))
  ) {
    return 'fee';
  }
  return 'purchase';
}
