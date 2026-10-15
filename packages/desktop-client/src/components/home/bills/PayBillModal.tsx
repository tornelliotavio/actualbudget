import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Form } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { InlineField } from '@actual-app/components/inline-field';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import { amountToInteger, toRelaxedNumber } from '@actual-app/core/shared/util';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useAccounts } from '#hooks/useAccounts';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';
import { useLocalPref } from '#hooks/useLocalPref';
import { useNavigate } from '#hooks/useNavigate';
import { usePayees } from '#hooks/usePayees';
import { pushModal } from '#modals/modalsSlice';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';
import { undo } from '#undo';

import { getBillPresentation } from './billPresentation';
import { amountForClipboard } from './clipboardAmount';
import { isPayable } from './homeBills';
import type { HomeBill } from './homeBills';
import { recordBillPayment } from './recordBillPayment';

/** Bank sync matches a payment recorded by hand up to this many days away. */
const MATCH_WINDOW_DAYS = 7;

type PayBillModalProps = {
  bill: HomeBill;
};

/**
 * Helps pay a bill in the bank's app (amount to copy, due date, account) and
 * records the payment so the bill shows as paid until the bank sends it.
 */
export function PayBillModal({ bill }: PayBillModalProps) {
  const { t } = useTranslation();
  const { label } = getBillPresentation(bill, t);

  return (
    <Modal name="pay-bill">
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={bill.name} shrinkOnOverflow />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <Text style={{ color: theme.pageTextSubdued, marginBottom: 12 }}>
            {label}
          </Text>
          {isPayable(bill) ? (
            <PayBillForm bill={bill} onClose={() => state.close()} />
          ) : (
            <BillActions bill={bill} onClose={() => state.close()} />
          )}
        </>
      )}
    </Modal>
  );
}

type PayBillFormProps = {
  bill: HomeBill;
  onClose: () => void;
};

function PayBillForm({ bill, onClose }: PayBillFormProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const dispatch = useDispatch();
  const { isNarrowWidth } = useResponsive();
  const { data: accounts = [] } = useAccounts();
  const { data: payees = [] } = usePayees();
  const [lastPayFrom, setLastPayFrom] = useLocalPref('home.payFromAccount');

  const payFromOptions = accounts.filter(
    account =>
      !account.closed && !account.offbudget && account.kind !== 'credit_card',
  );
  const defaultAccount =
    [bill.payFromAccountId, lastPayFrom].find(
      id => id && payFromOptions.some(account => account.id === id),
    ) ??
    payFromOptions[0]?.id ??
    '';

  const [accountId, setAccountId] = useState(defaultAccount);
  const [amountText, setAmountText] = useState(
    amountForClipboard(bill.amountDue, locale.code),
  );
  const [date, setDate] = useState(monthUtils.currentDay());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const amount = amountToInteger(toRelaxedNumber(amountText));
  const minimum = bill.cardBill?.minimumPayment ?? null;
  const isDifferentAmount = !bill.isEstimate && amount !== bill.amountDue;
  const daysFromDue = Math.abs(
    monthUtils.differenceInCalendarDays(date, bill.dueDate),
  );
  const isOpenBill =
    bill.cardBill?.status === 'open' || bill.cardBill?.status === 'upcoming';

  const copyAmount = async () => {
    try {
      await navigator.clipboard.writeText(
        amountForClipboard(amount, locale.code),
      );
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('Enter the amount you paid.'));
      return;
    }
    if (!accountId) {
      setError(t('Choose the account you paid from.'));
      return;
    }
    setIsSaving(true);
    try {
      await recordBillPayment(bill, { amount, date, accountId }, payees);
      setLastPayFrom(accountId);
      dispatch(
        addNotification({
          notification: {
            type: 'message',
            message: t('Payment of {{name}} recorded.', { name: bill.name }),
            button: { title: t('Undo'), action: undo },
          },
        }),
      );
      onClose();
    } catch {
      setError(t('The payment could not be recorded.'));
      setIsSaving(false);
    }
  };

  const labelWidth = isNarrowWidth ? 90 : 120;

  return (
    <Form onSubmit={onSubmit}>
      <View style={{ gap: 8, width: isNarrowWidth ? '100%' : 440 }}>
        <BillFacts bill={bill} />

        {bill.cardBill && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Button
              size={isNarrowWidth ? 'large' : 'small'}
              onPress={() =>
                setAmountText(amountForClipboard(bill.amountDue, locale.code))
              }
            >
              <Trans>Amount due</Trans>
            </Button>
            {minimum != null && minimum > 0 && (
              <Button
                size={isNarrowWidth ? 'large' : 'small'}
                onPress={() =>
                  setAmountText(amountForClipboard(minimum, locale.code))
                }
              >
                <Trans>Minimum</Trans>
              </Button>
            )}
          </View>
        )}

        <InlineField label={t('Amount')} width="100%" labelWidth={labelWidth}>
          <Input
            inputMode="decimal"
            value={amountText}
            onChangeValue={value => {
              setAmountText(value);
              setCopied(false);
            }}
            style={{ flex: 1, ...styles.tnum }}
          />
          <Button
            size={isNarrowWidth ? 'large' : 'medium'}
            onPress={() => void copyAmount()}
            style={{ marginLeft: 6 }}
          >
            {copied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
          </Button>
        </InlineField>
        <InlineField label={t('Pay from')} width="100%" labelWidth={labelWidth}>
          <Select
            value={accountId}
            onChange={setAccountId}
            options={payFromOptions.map(
              account => [account.id, account.name] as const,
            )}
            style={{ flex: 1 }}
          />
        </InlineField>
        <InlineField label={t('Paid on')} width="100%" labelWidth={labelWidth}>
          <Input
            type="date"
            value={date}
            onChangeValue={value => setDate(value || monthUtils.currentDay())}
            style={{ flex: 1 }}
          />
        </InlineField>

        {isOpenBill && (
          <Warning>
            <Trans>
              This bill hasn't closed yet. The bank may count a payment made
              before the closing date toward the previous bill.
            </Trans>
          </Warning>
        )}
        {isDifferentAmount && (
          <Warning>
            <Trans>
              The bank's copy of the payment only merges with this record when
              the amounts match exactly.
            </Trans>
          </Warning>
        )}
        {daysFromDue > MATCH_WINDOW_DAYS && (
          <Warning>
            <Trans>
              This date is more than a week from the due date. Use the date you
              actually paid so the bank's copy merges with this record.
            </Trans>
          </Warning>
        )}
        <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
          <Trans>
            Pay it in your bank's app, then record it here. When the bank syncs,
            its copy of the payment replaces this record instead of adding
            another.
          </Trans>
        </Text>
        {error && <FormError>{error}</FormError>}
      </View>
      <ModalButtons>
        <BillActions bill={bill} onClose={onClose} inline />
        <Button onPress={onClose} style={{ marginLeft: 10 }}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          type="submit"
          variant="primary"
          isDisabled={isSaving}
          style={{ marginLeft: 10 }}
        >
          <Trans>Record payment</Trans>
        </Button>
      </ModalButtons>
    </Form>
  );
}

function BillFacts({ bill }: { bill: HomeBill }) {
  const { t } = useTranslation();
  const format = useFormat();
  const locale = useLocale();
  const card = bill.cardBill;
  const rows: Array<[string, string]> = [
    [t('Due'), monthUtils.format(bill.dueDate, 'd MMMM yyyy', locale)],
    ...(card
      ? ([
          [t('Closes'), monthUtils.format(card.closingDate, 'd MMMM', locale)],
          [t('Bill total'), format(card.total, 'financial')],
          ...(card.paid > 0
            ? ([[t('Already paid'), format(card.paid, 'financial')]] as const)
            : []),
          ...(card.minimumPayment != null
            ? ([
                [t('Minimum'), format(card.minimumPayment, 'financial')],
              ] as const)
            : []),
        ] as Array<[string, string]>)
      : []),
    [t('Amount due'), format(bill.amountDue, 'financial')],
  ];

  return (
    <View
      style={{
        padding: 10,
        borderRadius: 4,
        border: `1px solid ${theme.tableBorder}`,
        gap: 4,
      }}
    >
      {rows.map(([label, value], index) => (
        <View
          key={label}
          style={{ flexDirection: 'row', justifyContent: 'space-between' }}
        >
          <Text style={{ color: theme.pageTextSubdued }}>{label}</Text>
          {index === 0 || (card && index === 1) ? (
            <Text>{value}</Text>
          ) : (
            <PrivacyFilter>
              <FinancialText
                style={
                  index === rows.length - 1 ? { fontWeight: 600 } : undefined
                }
              >
                {value}
              </FinancialText>
            </PrivacyFilter>
          )}
        </View>
      ))}
    </View>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <Text
      role="note"
      style={{
        ...styles.smallText,
        color: theme.warningTextDark,
        backgroundColor: theme.warningBackground,
        borderRadius: 4,
        padding: '6px 8px',
      }}
    >
      {children}
    </Text>
  );
}

type BillActionsProps = {
  bill: HomeBill;
  onClose: () => void;
  /** Rendered next to the form's buttons rather than on their own. */
  inline?: boolean;
};

/** Ways to deal with a bill besides paying it. */
function BillActions({ bill, onClose, inline = false }: BillActionsProps) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { isNarrowWidth } = useResponsive();

  const viewSchedule = () => {
    onClose();
    if (isNarrowWidth) {
      void navigate(`/schedules/${bill.scheduleId}`);
    } else {
      dispatch(
        pushModal({
          modal: { name: 'schedule-edit', options: { id: bill.scheduleId! } },
        }),
      );
    }
  };
  const skip = async () => {
    await send('schedule/skip-next-date', { id: bill.scheduleId! });
    onClose();
  };
  const viewCard = () => {
    onClose();
    void navigate(`/accounts/${bill.cardAccountId}`);
  };

  const canSkip = bill.scheduleId != null && bill.status !== 'paid';
  const buttons = (
    <>
      {bill.cardAccountId && (
        <Button variant="bare" onPress={viewCard}>
          <Trans>View card</Trans>
        </Button>
      )}
      {bill.scheduleId && (
        <Button variant="bare" onPress={viewSchedule}>
          <Trans>Edit schedule</Trans>
        </Button>
      )}
      {canSkip && (
        <Button variant="bare" onPress={() => void skip()}>
          <Trans>Skip this date</Trans>
        </Button>
      )}
    </>
  );

  if (inline) {
    return (
      <View style={{ flexDirection: 'row', marginRight: 'auto' }}>
        {buttons}
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <BillFacts bill={bill} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {buttons}
      </View>
      <ModalButtons>
        <Button onPress={onClose}>
          <Trans>Close</Trans>
        </Button>
      </ModalButtons>
    </View>
  );
}
