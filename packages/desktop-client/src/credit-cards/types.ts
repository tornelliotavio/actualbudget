import type { Handlers } from '@actual-app/core/types/handlers';

type Result<Name extends keyof Handlers> = Exclude<
  Awaited<ReturnType<Handlers[Name]>>,
  { error: string }
>;

export type CardProjection = Result<'credit-cards-projection'>;
export type CreditCard = CardProjection['card'];
export type CardSummary = CardProjection['summary'];
export type CardBill = CardProjection['bills'][number];
export type CardBillLine = CardProjection['lines'][string][number];
export type CardPurchase = CardProjection['purchases'][number];
export type CardInstallment = CardProjection['installments'][number];
export type CardPayment = CardProjection['payments'][number];
export type CardUnlinkedPayment = CardProjection['unlinkedPayments'][number];
export type CardBillStatus = CardBill['status'];
