import { theme } from '@actual-app/components/theme';
import type { CardBill } from '@actual-app/core/server/credit-cards/bills';

export type CardBillStatus = CardBill['status'];

export function getBillStatusLabel(
  status: CardBillStatus,
  t: (text: string) => string,
) {
  switch (status) {
    case 'upcoming':
      return t('Upcoming');
    case 'open':
      return t('Open');
    case 'closed':
      return t('Closed');
    case 'partially_paid':
      return t('Partially paid');
    case 'paid':
      return t('Paid');
    case 'overdue':
      return t('Overdue');
    default:
      return status satisfies never;
  }
}

export function getBillStatusColors(status: CardBillStatus) {
  switch (status) {
    case 'paid':
      return {
        color: theme.noticeText,
        backgroundColor: theme.noticeBackgroundLight,
      };
    case 'overdue':
      return {
        color: theme.errorTextDarker,
        backgroundColor: theme.errorBackground,
      };
    case 'closed':
    case 'partially_paid':
      return {
        color: theme.warningTextDark,
        backgroundColor: theme.warningBackground,
      };
    case 'open':
    case 'upcoming':
      return {
        color: theme.upcomingText,
        backgroundColor: theme.upcomingBackground,
      };
    default:
      return status satisfies never;
  }
}
