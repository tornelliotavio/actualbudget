import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';

import { Link } from '#components/common/Link';
import { FinancialText } from '#components/FinancialText';
import { HomeSection } from '#components/home/HomeSection';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { getBillPresentation } from './billPresentation';
import { isPayable } from './homeBills';
import type { HomeBill, HomeBillTotals } from './homeBills';

type BillsSectionProps = {
  bills: HomeBill[];
  totals: HomeBillTotals;
  isLoading: boolean;
};

/** The month's bills: what is left to pay first, then what was paid. */
export function BillsSection({ bills, totals, isLoading }: BillsSectionProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const { isNarrowWidth } = useResponsive();
  const [showPaid, setShowPaid] = useState(!isNarrowWidth);

  const pending = bills.filter(bill => bill.status !== 'paid');
  const paid = bills.filter(bill => bill.status === 'paid');

  return (
    <HomeSection
      id="bills"
      title={t('Bills this month')}
      action={
        <Link variant="internal" to="/schedules" style={styles.smallText}>
          <Trans>Schedules</Trans>
        </Link>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '4px 16px' }}>
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>Left to pay</Trans>{' '}
          <PrivacyFilter>
            <FinancialText style={{ color: theme.pageText, fontWeight: 600 }}>
              {format(totals.toPay, 'financial')}
            </FinancialText>
          </PrivacyFilter>
        </Text>
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>Already paid</Trans>{' '}
          <PrivacyFilter>
            <FinancialText>{format(totals.paid, 'financial')}</FinancialText>
          </PrivacyFilter>
        </Text>
        {totals.overdueCount > 0 && (
          <Text style={{ color: theme.errorText, fontWeight: 600 }}>
            {t('{{count}} overdue', { count: totals.overdueCount })}
          </Text>
        )}
      </View>

      {isLoading && bills.length === 0 ? (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>Loading...</Trans>
        </Text>
      ) : bills.length === 0 ? (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>
            No bills this month. Bills come from your schedules and credit
            cards.
          </Trans>
        </Text>
      ) : (
        <View>
          {pending.length === 0 && (
            <Text style={{ color: theme.noticeText, padding: '8px 0' }}>
              <Trans>Everything is paid this month.</Trans>
            </Text>
          )}
          {pending.map(bill => (
            <BillRow key={bill.id} bill={bill} />
          ))}
          {paid.length > 0 && (
            <Button
              variant="bare"
              aria-expanded={showPaid}
              onPress={() => setShowPaid(!showPaid)}
              style={{
                justifyContent: 'flex-start',
                padding: '10px 0 6px',
                color: theme.pageTextSubdued,
                ...styles.smallText,
              }}
            >
              {showPaid
                ? t('Hide paid ({{count}})', { count: paid.length })
                : t('Show paid ({{count}})', { count: paid.length })}
            </Button>
          )}
          {showPaid && paid.map(bill => <BillRow key={bill.id} bill={bill} />)}
        </View>
      )}
    </HomeSection>
  );
}

function BillRow({ bill }: { bill: HomeBill }) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isNarrowWidth } = useResponsive();
  const { color, Icon, label } = getBillPresentation(bill, t);
  const isPaid = bill.status === 'paid';
  const amount = isPaid ? bill.amount : bill.amountDue;
  const dueDate = monthUtils.format(bill.dueDate, 'd MMM', locale);

  const open = () => {
    if (bill.scheduleId || isPayable(bill)) {
      dispatch(pushModal({ modal: { name: 'pay-bill', options: { bill } } }));
    } else if (bill.cardAccountId) {
      void navigate(`/accounts/${bill.cardAccountId}`);
    }
  };

  const amountText = (bill.isEstimate ? '~' : '') + format(amount, 'financial');

  return (
    <View style={{ borderTop: `1px solid ${theme.tableBorder}` }}>
      <Button
        variant="bare"
        onPress={open}
        aria-label={t('{{name}}, {{status}}, due {{date}}, {{amount}}', {
          name: bill.name,
          status: label,
          date: dueDate,
          amount: amountText,
        })}
        style={{
          justifyContent: 'flex-start',
          alignItems: 'center',
          gap: 10,
          padding: isNarrowWidth ? '10px 2px' : '8px 4px',
          minHeight: isNarrowWidth ? 48 : 40,
          borderRadius: 4,
          textAlign: 'left',
          color: isPaid ? theme.pageTextSubdued : theme.pageText,
        }}
      >
        <Icon
          aria-hidden
          style={{ width: 14, height: 14, flexShrink: 0, color }}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ fontWeight: 500, ...styles.lineClamp(1) }}>
            {bill.name}
          </Text>
          <Text style={{ ...styles.smallText, color }}>
            {label}
            <Text style={{ color: theme.pageTextSubdued }}>
              {' · '}
              {t('due {{date}}', { date: dueDate })}
            </Text>
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <PrivacyFilter>
            <FinancialText
              style={{
                fontWeight: 600,
                color: bill.isIncome ? theme.reportsNumberPositive : undefined,
              }}
            >
              {(bill.isIncome ? '+' : '') + amountText}
            </FinancialText>
          </PrivacyFilter>
          {bill.status === 'partially_paid' && (
            <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
              <PrivacyFilter>
                {t('of {{total}}', {
                  total: format(bill.amount, 'financial'),
                })}
              </PrivacyFilter>
            </Text>
          )}
        </View>
      </Button>
    </View>
  );
}
