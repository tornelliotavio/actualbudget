import { useState } from 'react';
import type { FormEvent } from 'react';
import { Form } from 'react-aria-components';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { InlineField } from '@actual-app/components/inline-field';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { q } from '@actual-app/core/shared/query';
import {
  amountToInteger,
  integerToAmount,
  toRelaxedNumber,
} from '@actual-app/core/shared/util';
import type {
  AccountEntity,
  CardProfileEntity,
} from '@actual-app/core/types/models';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useAccount } from '#hooks/useAccount';
import { useQuery } from '#hooks/useQuery';

type CardSettingsModalProps = {
  accountId: AccountEntity['id'];
};

type ClosingDayBill = 'next' | 'closing';

export function CardSettingsModal({ accountId }: CardSettingsModalProps) {
  const account = useAccount(accountId);
  const { data } = useQuery<CardProfileEntity>(
    () => q('card_profiles').filter({ id: accountId }).select('*'),
    [accountId],
  );
  const profile = data?.[0];

  return (
    <Modal name="card-settings">
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={account?.name ?? ''} shrinkOnOverflow />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          {data && account && (
            <CardSettingsForm
              account={account}
              profile={profile ?? null}
              onClose={() => state.close()}
            />
          )}
        </>
      )}
    </Modal>
  );
}

type CardSettingsFormProps = {
  account: AccountEntity;
  profile: CardProfileEntity | null;
  onClose: () => void;
};

function dayText(day: number | null | undefined) {
  return day == null ? '' : String(day);
}

function parseDay(value: string): number | null | 'invalid' {
  if (value.trim() === '') {
    return null;
  }
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : 'invalid';
}

function CardSettingsForm({
  account,
  profile,
  onClose,
}: CardSettingsFormProps) {
  const { t } = useTranslation();
  const [closingDay, setClosingDay] = useState(
    dayText(profile?.closing_day_user),
  );
  const [dueDay, setDueDay] = useState(dayText(profile?.due_day_user));
  const [closingDayBill, setClosingDayBill] = useState<ClosingDayBill>(
    profile?.closing_day_on_closing_bill ? 'closing' : 'next',
  );
  const [creditLimit, setCreditLimit] = useState(
    profile?.credit_limit_user == null
      ? ''
      : String(integerToAmount(profile.credit_limit_user)),
  );
  const [paymentPatterns, setPaymentPatterns] = useState(
    profile?.payment_patterns ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  const bankDay = (day: number | null | undefined) =>
    day == null
      ? t('Day of the month')
      : t('Bank: day {{day}}', { day: String(day) });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const closing = parseDay(closingDay);
    const due = parseDay(dueDay);
    if (closing === 'invalid' || due === 'invalid') {
      setError(t('Days must be numbers from 1 to 31'));
      return;
    }
    const limit =
      creditLimit.trim() === ''
        ? null
        : amountToInteger(toRelaxedNumber(creditLimit));
    await send('credit-card-settings-update', {
      accountId: account.id,
      fields: {
        closing_day_user: closing,
        due_day_user: due,
        closing_day_on_closing_bill: closingDayBill === 'closing',
        credit_limit_user: limit,
        payment_patterns: paymentPatterns.trim() || null,
      },
    });
    onClose();
  };

  return (
    <Form onSubmit={onSubmit}>
      <View style={{ gap: 4, minWidth: 420 }}>
        <InlineField label={t('Closes on')} width="100%" labelWidth={160}>
          <Input
            inputMode="numeric"
            placeholder={bankDay(profile?.closing_day_provider)}
            value={closingDay}
            onChangeValue={setClosingDay}
            style={{ flex: 1 }}
          />
        </InlineField>
        <InlineField label={t('Due on')} width="100%" labelWidth={160}>
          <Input
            inputMode="numeric"
            placeholder={bankDay(profile?.due_day_provider)}
            value={dueDay}
            onChangeValue={setDueDay}
            style={{ flex: 1 }}
          />
        </InlineField>
        <InlineField
          label={t('Closing-day purchases')}
          width="100%"
          labelWidth={160}
        >
          <Select<ClosingDayBill>
            value={closingDayBill}
            onChange={setClosingDayBill}
            options={[
              ['next', t('Go to the next bill')],
              ['closing', t('Stay on the closing bill')],
            ]}
            style={{ flex: 1 }}
          />
        </InlineField>
        <InlineField label={t('Limit')} width="100%" labelWidth={160}>
          <Input
            inputMode="decimal"
            placeholder={
              account.balance_limit == null
                ? ''
                : t('Bank: {{limit}}', {
                    limit: String(integerToAmount(account.balance_limit)),
                  })
            }
            value={creditLimit}
            onChangeValue={setCreditLimit}
            style={{ flex: 1 }}
          />
        </InlineField>
        <InlineField
          label={t('Bill payment descriptions')}
          width="100%"
          labelWidth={160}
        >
          <Input
            placeholder={t('e.g. PAGAMENTO FATURA, PAGTO DEBITO AUTOMATICO')}
            value={paymentPatterns}
            onChangeValue={setPaymentPatterns}
            style={{ flex: 1 }}
          />
        </InlineField>
        <Text
          style={{
            color: theme.pageTextLight,
            fontSize: '0.8em',
            marginLeft: 160,
            lineHeight: 1.4,
          }}
        >
          <Trans>
            Leave a field empty to use what the bank reports. Payment
            descriptions are separated by commas and only needed when the bank
            does not mark bill payments itself.
          </Trans>
        </Text>
        {error && <FormError style={{ marginLeft: 160 }}>{error}</FormError>}
      </View>
      <ModalButtons>
        <Button onPress={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="submit" variant="primary" style={{ marginLeft: 10 }}>
          <Trans>Save</Trans>
        </Button>
      </ModalButtons>
    </Form>
  );
}
