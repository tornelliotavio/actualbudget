import { describe, expect, it } from 'vitest';

import { billId, installmentId, purchaseFingerprint } from './ids';
import {
  normalizeDescription,
  parseInstallmentLabel,
  splitInstallments,
} from './installments';
import { readCardMetadata } from './metadata';

describe('installments', () => {
  it('splits an even purchase into equal parts', () => {
    expect(splitInstallments(120000, 6)).toEqual([
      20000, 20000, 20000, 20000, 20000, 20000,
    ]);
  });

  it('gives leftover cents to the earliest installments and preserves the total', () => {
    const parts = splitInstallments(100, 3);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((total, part) => total + part, 0)).toBe(100);

    const negative = splitInstallments(-100, 3);
    expect(negative).toEqual([-34, -33, -33]);
    expect(negative.reduce((total, part) => total + part, 0)).toBe(-100);
  });

  it('reads Brazilian installment markers and ignores dates', () => {
    expect(parseInstallmentLabel('PARC 02/06 LOJA')).toEqual({
      number: 2,
      total: 6,
    });
    expect(parseInstallmentLabel('PARCELA 2 DE 6')).toEqual({
      number: 2,
      total: 6,
    });
    expect(parseInstallmentLabel('MERCADO 2/6')).toEqual({
      number: 2,
      total: 6,
    });
    expect(parseInstallmentLabel('10/10/2026 mercado')).toBeNull();
    expect(parseInstallmentLabel('sem parcela')).toBeNull();
    expect(parseInstallmentLabel('PARC 7/6')).toBeNull();
  });

  it('normalizes descriptions so the same purchase fingerprints once', () => {
    const first = purchaseFingerprint({
      cardId: 'card',
      purchaseDate: '2026-09-02',
      totalAmount: 120000,
      installmentCount: 6,
      description: 'Loja  Centro',
    });
    const second = purchaseFingerprint({
      cardId: 'card',
      purchaseDate: '2026-09-02',
      totalAmount: 120000,
      installmentCount: 6,
      description: 'loja centro',
    });
    expect(first).toBe(second);
    expect(normalizeDescription('Açúcar  1')).toBe('acucar 1');
  });

  it('builds stable ids', () => {
    expect(billId('card', '2026-10')).toBe('card:2026-10');
    expect(installmentId('purchase', 2)).toBe('purchase:2');
    expect(billId('card', '2026-10')).toBe(billId('card', '2026-10'));
  });

  it('reads flattened Pluggy metadata and leaves gaps null', () => {
    expect(
      readCardMetadata({
        originalDate: '2026-08-02T00:00:00.000Z',
        'creditCardMetadata.billId': 'bill-1',
        'creditCardMetadata.installmentNumber': 2,
        'creditCardMetadata.totalInstallments': '6',
        'creditCardMetadata.purchaseDate': '2026-08-02',
        'creditCardMetadata.totalAmount': 1200,
      }),
    ).toEqual({
      billId: 'bill-1',
      installmentNumber: 2,
      totalInstallments: 6,
      purchaseDate: '2026-08-02',
      totalAmount: 1200,
      originalDate: '2026-08-02',
    });
    expect(readCardMetadata('not json')).toBeNull();
    expect(readCardMetadata({ notes: 'hello' })).toBeNull();
  });
});
