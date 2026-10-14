import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import {
  SvgCheveronLeft,
  SvgCheveronRight,
} from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { Toggle } from '@actual-app/components/toggle';
import { View } from '@actual-app/components/view';
import type {
  CardBill,
  CardLimit,
} from '@actual-app/core/server/credit-cards/bills';
import * as monthUtils from '@actual-app/core/shared/months';
import type { AccountEntity } from '@actual-app/core/types/models';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useCardBills } from '#hooks/useCardBills';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import { getBillStatusColors, getBillStatusLabel } from './billStatus';

type CardBillPanelProps = {
  account: AccountEntity;
  /** Bill shown; `null` shows the one the card is on now. */
  month: string | null;
  showOnlyBill: boolean;
  onChangeMonth: (month: string) => void;
  onToggleShowOnlyBill: (showOnlyBill: boolean, month: string) => void;
  onOpenSettings: () => void;
};

/**
 * The bills of a credit card, one month at a time: what the bill asks for,
 * when it closes and is due, what was paid, and the card's limit.
 */
export function CardBillPanel({
  account,
  month,
  showOnlyBill,
  onChangeMonth,
  onToggleShowOnlyBill,
  onOpenSettings,
}: CardBillPanelProps) {
  const { t } = useTranslation();
  const { data } = useCardBills(account.id);

  if (!data) {
    return null;
  }
  if (data.status === 'needs-schedule') {
    return (
      <PanelFrame>
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            Set the closing and due days of this card to see its bills.
          </Trans>
        </Text>
        <Button variant="bare" onPress={onOpenSettings}>
          <Trans>Card settings</Trans>
        </Button>
      </PanelFrame>
    );
  }
  if (data.status !== 'ok') {
    return null;
  }

  const selectedMonth = month ?? data.currentMonth;
  const index = data.bills.findIndex(
    bill => bill.referenceMonth === selectedMonth,
  );
  const bill = data.bills[index] ?? data.bills[data.bills.length - 1];
  if (!bill) {
    return null;
  }
  const previous = data.bills[index - 1];
  const next = data.bills[index + 1];

  return (
    <PanelFrame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Button
          variant="bare"
          aria-label={t('Previous bill')}
          isDisabled={!previous}
          onPress={() => previous && onChangeMonth(previous.referenceMonth)}
        >
          <SvgCheveronLeft width={14} height={14} />
        </Button>
        <BillTitle bill={bill} />
        <Button
          variant="bare"
          aria-label={t('Next bill')}
          isDisabled={!next}
          onPress={() => next && onChangeMonth(next.referenceMonth)}
        >
          <SvgCheveronRight width={14} height={14} />
        </Button>
      </View>

      <BillFigures bill={bill} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Toggle
            id={`card-bill-only-${account.id}`}
            isOn={showOnlyBill}
            onToggle={isOn => onToggleShowOnlyBill(isOn, bill.referenceMonth)}
          />
          <label
            htmlFor={`card-bill-only-${account.id}`}
            style={{ ...styles.smallText, color: theme.pageTextSubdued }}
          >
            <Trans>Show only this bill's transactions</Trans>
          </label>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <LimitSummary limit={data.limit} />
          <Button variant="bare" onPress={onOpenSettings}>
            <Trans>Card settings</Trans>
          </Button>
        </View>
      </View>
    </PanelFrame>
  );
}

function PanelFrame({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        alignSelf: 'stretch',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 6,
        border: `1px solid ${theme.tableBorder}`,
        backgroundColor: theme.tableBackground,
      }}
    >
      {children}
    </View>
  );
}

function BillTitle({ bill }: { bill: CardBill }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const colors = getBillStatusColors(bill.status);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ ...styles.mediumText, fontWeight: 600 }}>
        {t('{{month}} bill', {
          month: monthUtils.format(bill.referenceMonth, 'MMMM yyyy', locale),
        })}
      </Text>
      <Text
        style={{
          ...styles.smallText,
          borderRadius: 4,
          padding: '2px 6px',
          ...colors,
        }}
      >
        {getBillStatusLabel(bill.status, t)}
      </Text>
      {!bill.complete && (
        <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
          <Trans>History starts mid-cycle</Trans>
        </Text>
      )}
    </View>
  );
}

function BillFigures({ bill }: { bill: CardBill }) {
  const { t } = useTranslation();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();
  const shortDate = (date: string) =>
    monthUtils.format(date, monthUtils.getDayMonthFormat(dateFormat), locale);
  const isClosed = bill.status !== 'open' && bill.status !== 'upcoming';

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
      <Figure label={t('Total')} amount={bill.total} emphasis />
      {bill.projectedCharges !== 0 && (
        <Figure
          label={t('Of which projected installments')}
          amount={bill.projectedCharges}
        />
      )}
      {bill.previousBalance !== 0 && (
        <Figure
          label={t('From the previous bill')}
          amount={bill.previousBalance}
        />
      )}
      {isClosed && <Figure label={t('Paid')} amount={bill.paid} />}
      {isClosed && bill.remaining > 0 && (
        <Figure label={t('Left to pay')} amount={bill.remaining} />
      )}
      {bill.minimumPayment != null && bill.remaining > 0 && (
        <Figure label={t('Minimum payment')} amount={bill.minimumPayment} />
      )}
      <DateFigure
        label={isClosed ? t('Closed on') : t('Closes on')}
        value={shortDate(bill.closingDate)}
      />
      <DateFigure
        label={t('Due on')}
        value={shortDate(bill.effectiveDueDate)}
      />
      {bill.divergence != null && bill.divergence !== 0 && (
        <Figure
          label={t('Difference from the bank')}
          amount={bill.divergence}
          color={theme.warningText}
        />
      )}
    </View>
  );
}

type FigureProps = {
  label: string;
  amount: number;
  emphasis?: boolean;
  color?: string;
};

function Figure({ label, amount, emphasis, color }: FigureProps) {
  const format = useFormat();
  return (
    <View>
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>
      <PrivacyFilter>
        <FinancialText
          style={{
            fontWeight: emphasis ? 600 : 400,
            fontSize: emphasis ? 16 : undefined,
            color: color ?? theme.pageText,
          }}
        >
          {format(amount, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}

function DateFigure({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}

function LimitSummary({ limit }: { limit: CardLimit }) {
  const { t } = useTranslation();
  const format = useFormat();
  if (limit.total == null) {
    return null;
  }
  const share = limit.total > 0 ? Math.min(1, limit.used / limit.total) : 0;
  return (
    <View style={{ gap: 3, minWidth: 220 }}>
      <PrivacyFilter>
        <Text
          style={{
            ...styles.smallText,
            ...styles.tnum,
            color: theme.pageTextSubdued,
          }}
        >
          {t('Limit used: {{used}} of {{total}}, {{available}} available', {
            used: format(limit.used, 'financial'),
            total: format(limit.total, 'financial'),
            available: format(limit.available ?? 0, 'financial'),
          })}
        </Text>
      </PrivacyFilter>
      <View
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: theme.tableBorder,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${share * 100}%`,
            height: '100%',
            backgroundColor: share > 0.9 ? theme.errorText : theme.pageTextLink,
          }}
        />
      </View>
    </View>
  );
}
