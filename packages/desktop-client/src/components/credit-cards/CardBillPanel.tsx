import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
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

import { PrivacyFilter } from '#components/PrivacyFilter';
import { useCardBills } from '#hooks/useCardBills';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

import { BillBreakdown } from './BillBreakdown';
import { BillCycleTrack } from './BillCycleTrack';
import { BillHeadline } from './BillHeadline';
import { BillHistoryChart } from './BillHistoryChart';
import {
  getBillStatusColors,
  getBillStatusLabel,
  getDefaultBillMonth,
} from './billStatus';
import { compareWithPastBills, getBillTrend } from './billTrend';

type CardBillPanelProps = {
  account: AccountEntity;
  /** Bill shown; `null` shows the one the card is on now. */
  month: string | null;
  onChangeMonth: (month: string) => void;
  onOpenSettings: () => void;
  /** Present where the register can be narrowed to one bill. */
  showOnlyBill?: boolean;
  onToggleShowOnlyBill?: (showOnlyBill: boolean, month: string) => void;
};

/**
 * The bills of a credit card, one month at a time: what the bill asks for and
 * what it is made of, where its cycle stands, how it compares with the bills
 * around it, and the card's limit.
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
  const { isNarrowWidth } = useResponsive();

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

  const selectedMonth =
    month ??
    getDefaultBillMonth(
      data.bills,
      data.currentMonth,
      monthUtils.currentMonth(),
    );
  const index = data.bills.findIndex(
    bill => bill.referenceMonth === selectedMonth,
  );
  const bill = data.bills[index] ?? data.bills[data.bills.length - 1];
  if (!bill) {
    return null;
  }
  const resolvedIndex = data.bills.indexOf(bill);
  const previous = data.bills[resolvedIndex - 1];
  const next = data.bills[resolvedIndex + 1];
  const trend = getBillTrend(data.bills, resolvedIndex);
  const comparison = compareWithPastBills(data.bills, resolvedIndex);
  const settingsButton = (
    <Button variant="bare" onPress={onOpenSettings}>
      <Trans>Card settings</Trans>
    </Button>
  );

  return (
    <PanelFrame>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
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
        {!isNarrowWidth && settingsButton}
      </View>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: '16px 28px',
        }}
      >
        <View style={{ flex: '1 1 280px', gap: 14, minWidth: 0 }}>
          <BillHeadline bill={bill} comparison={comparison} />
          <BillBreakdown bill={bill} />
          <BillCycleTrack bill={bill} today={monthUtils.currentDay()} />
        </View>
        {trend.length > 1 && (
          <View style={{ flex: '1.4 1 300px', gap: 4, minWidth: 0 }}>
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              <Trans>Recent bills</Trans>
            </Text>
            <BillHistoryChart
              points={trend}
              selectedMonth={bill.referenceMonth}
              average={comparison?.average ?? null}
              height={isNarrowWidth ? 140 : 170}
              onSelectMonth={onChangeMonth}
            />
          </View>
        )}
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          paddingTop: 10,
          borderTop: `1px solid ${theme.tableBorder}`,
        }}
      >
        {onToggleShowOnlyBill && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Toggle
              id={`card-bill-only-${account.id}`}
              isOn={!!showOnlyBill}
              onToggle={isOn => onToggleShowOnlyBill(isOn, bill.referenceMonth)}
            />
            <label
              htmlFor={`card-bill-only-${account.id}`}
              style={{ ...styles.smallText, color: theme.pageTextSubdued }}
            >
              <Trans>Show only this bill's transactions</Trans>
            </label>
          </View>
        )}
        <LimitSummary limit={data.limit} />
        {isNarrowWidth && settingsButton}
      </View>
    </PanelFrame>
  );
}

function PanelFrame({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        alignSelf: 'stretch',
        gap: 12,
        padding: '12px 14px',
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
