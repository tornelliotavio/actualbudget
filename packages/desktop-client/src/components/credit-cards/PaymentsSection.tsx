import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useAllocatePayment, useUnlinkPayment } from '#credit-cards';
import type { CardBill, CardPayment, CardUnlinkedPayment } from '#credit-cards';
import { useFormat } from '#hooks/useFormat';
import { usePrivacyMode } from '#hooks/usePrivacyMode';

import { Failure, Money, Panel, SourceBadge, useCardDates } from './ui';

function dayDistance(a: string, b: string) {
  return Math.abs(Date.parse(a) - Date.parse(b));
}

function suggestBill(payment: CardUnlinkedPayment, bills: CardBill[]) {
  const unpaid = bills.filter(bill => bill.remaining > 0 && !bill.cancelled);
  const exact = unpaid.find(bill => bill.remaining === payment.amount);
  if (exact) {
    return exact.id;
  }
  const pool = unpaid.length > 0 ? unpaid : bills;
  const nearest = pool
    .slice()
    .sort(
      (a, b) =>
        dayDistance(a.dueDate, payment.date) -
        dayDistance(b.dueDate, payment.date),
    )[0];
  return nearest?.id ?? '';
}

export function PaymentsSection({
  cardId,
  bills,
  payments,
  unlinked,
  readOnly,
}: {
  cardId: string;
  bills: CardBill[];
  payments: CardPayment[];
  unlinked: CardUnlinkedPayment[];
  readOnly: boolean;
}) {
  const dates = useCardDates();
  const unlink = useUnlinkPayment();
  const billMonth = new Map(bills.map(bill => [bill.id, bill.referenceMonth]));
  const linked = payments
    .slice()
    .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));

  return (
    <View style={{ gap: 20 }}>
      <Panel flush title={<Trans>Waiting to be linked</Trans>}>
        <Text
          style={{
            ...styles.smallText,
            color: theme.pageTextLight,
            padding: '10px 16px',
            borderBottom: `1px solid ${theme.tableBorder}`,
          }}
        >
          <Trans>
            Transfers that paid this card. Linking one marks the bill as paid
            and never creates a new expense.
          </Trans>
        </Text>
        {unlinked.length === 0 ? (
          <Text style={{ color: theme.pageTextSubdued, padding: 16 }}>
            <Trans>Every payment on this card is linked to a bill.</Trans>
          </Text>
        ) : (
          unlinked
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(payment => (
              <UnlinkedRow
                key={payment.id}
                cardId={cardId}
                payment={payment}
                bills={bills}
                readOnly={readOnly}
              />
            ))
        )}
      </Panel>

      <Panel flush title={<Trans>Linked payments</Trans>}>
        {linked.length === 0 ? (
          <Text style={{ color: theme.pageTextSubdued, padding: 16 }}>
            <Trans>No payments linked yet.</Trans>
          </Text>
        ) : (
          linked.map(payment => {
            const month = billMonth.get(payment.billId);
            return (
              <PaymentLine
                key={payment.id}
                date={dates.day(payment.paymentDate)}
                title={
                  month ? (
                    <Trans>Paid {{ month: dates.month(month) }}</Trans>
                  ) : (
                    <Trans>Paid a removed bill</Trans>
                  )
                }
                badge={<SourceBadge source={payment.source} />}
                amount={payment.amount}
              >
                <Button
                  variant="bare"
                  isDisabled={readOnly || unlink.isPending}
                  onPress={() => unlink.mutate(payment.id)}
                  style={{ color: theme.pageTextLight }}
                >
                  <Trans>Unlink</Trans>
                </Button>
              </PaymentLine>
            );
          })
        )}
        {unlink.error && <Failure message={unlink.error.message} />}
      </Panel>
    </View>
  );
}

function UnlinkedRow({
  cardId,
  payment,
  bills,
  readOnly,
}: {
  cardId: string;
  payment: CardUnlinkedPayment;
  bills: CardBill[];
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const privacyMode = usePrivacyMode();
  const dates = useCardDates();
  const allocate = useAllocatePayment();
  const [billId, setBillId] = useState(() => suggestBill(payment, bills));
  const options = bills
    .slice()
    .reverse()
    .map(bill => {
      const month = dates.shortMonth(bill.referenceMonth);
      const label =
        privacyMode || bill.remaining <= 0
          ? month
          : `${month} · ${format(bill.remaining, 'financial')}`;
      return [bill.id, label] as const;
    });

  return (
    <>
      <PaymentLine
        date={dates.day(payment.date)}
        title={payment.payeeName || <Trans>Payment</Trans>}
        amount={payment.amount}
      >
        <Select
          options={options}
          value={billId}
          defaultLabel={t('Choose a bill')}
          onChange={setBillId}
          style={{ minWidth: 170 }}
        />
        <Button
          variant="primary"
          isDisabled={readOnly || billId === '' || allocate.isPending}
          onPress={() => {
            allocate.mutate({
              cardId,
              billId,
              transactionId: payment.id,
              amount: payment.amount,
            });
          }}
        >
          <Trans>Link</Trans>
        </Button>
      </PaymentLine>
      {allocate.error && (
        <View style={{ padding: '0 16px 12px' }}>
          <Failure message={allocate.error.message} />
        </View>
      )}
    </>
  );
}

function PaymentLine({
  date,
  title,
  badge,
  amount,
  children,
}: {
  date: string;
  title: ReactNode;
  badge?: ReactNode;
  amount: number;
  children?: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
        padding: '10px 16px',
        borderBottom: `1px solid ${theme.tableBorder}`,
        ':last-child': { borderBottom: 0 },
      }}
    >
      <Text
        style={{
          ...styles.smallText,
          color: theme.pageTextLight,
          width: 90,
          flexShrink: 0,
        }}
      >
        {date}
      </Text>
      <View
        style={{
          flex: '1 1 160px',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        <Text style={{ ...styles.ellipsisText, color: theme.tableText }}>
          {title}
        </Text>
        {badge}
      </View>
      <Money
        amount={amount}
        style={{
          width: 110,
          textAlign: 'right',
          fontWeight: 500,
          color: theme.noticeTextLight,
        }}
      />
      {children && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {children}
        </View>
      )}
    </View>
  );
}
