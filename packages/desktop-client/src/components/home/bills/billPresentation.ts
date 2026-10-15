import type { TFunction } from 'i18next';

import { getStatusProps } from '#components/schedules/StatusBadge';

import type { HomeBill } from './homeBills';

/** Label, color and icon of a bill's status; never color alone. */
export function getBillPresentation(bill: HomeBill, t: TFunction) {
  switch (bill.status) {
    case 'overdue':
      return {
        ...getStatusProps('missed'),
        label: bill.isIncome ? t('Not received') : t('Overdue'),
      };
    case 'due':
      return { ...getStatusProps('due'), label: t('Due') };
    case 'partially_paid':
      return { ...getStatusProps('due'), label: t('Partially paid') };
    case 'upcoming':
      return { ...getStatusProps('upcoming'), label: t('Upcoming') };
    case 'open':
      return { ...getStatusProps('upcoming'), label: t('Open bill') };
    case 'scheduled':
      return { ...getStatusProps('scheduled'), label: t('Scheduled') };
    case 'paid':
      return {
        ...getStatusProps('paid'),
        label: bill.isIncome
          ? t('Received')
          : bill.awaitingBank
            ? t('Paid, waiting for the bank')
            : t('Paid'),
      };
    default:
      return bill.status satisfies never;
  }
}
