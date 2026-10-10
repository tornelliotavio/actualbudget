import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { useQuery } from '@tanstack/react-query';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { creditCardQueries, useCreateCreditCard } from '#credit-cards';
import { useAccounts } from '#hooks/useAccounts';
import { useFormat } from '#hooks/useFormat';

import { Failure, FieldLabel, Notice } from './ui';

export function CreateCardModal() {
  const { t } = useTranslation();
  const format = useFormat();
  const accounts = useAccounts();
  const cards = useQuery(creditCardQueries.list());
  const createCard = useCreateCreditCard();
  const requestSerial = useRef(0);
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [closingDay, setClosingDay] = useState('10');
  const [dueDay, setDueDay] = useState('17');
  const [policy, setPolicy] = useState<'next' | 'current'>('next');
  const [limit, setLimit] = useState('');
  const [provider, setProvider] = useState<'manual' | 'pluggyai'>('manual');
  const [providerAccountId, setProviderAccountId] = useState<string | null>(
    null,
  );
  const [readingBank, setReadingBank] = useState(false);
  const [bankStatus, setBankStatus] = useState<'idle' | 'filled' | 'missing'>(
    'idle',
  );
  const [limitsFromBank, setLimitsFromBank] = useState(false);
  const [bankAvailable, setBankAvailable] = useState<number | null>(null);
  const [limitEdited, setLimitEdited] = useState(false);

  const used = new Set((cards.data ?? []).map(card => card.accountId));
  const available = (accounts.data ?? []).filter(
    account => account.closed === 0 && !used.has(account.id),
  );

  async function onAccount(next: string) {
    const serial = requestSerial.current + 1;
    requestSerial.current = serial;
    setAccountId(next);
    setBankStatus('idle');
    const account = available.find(item => item.id === next);
    const pluggyId =
      account?.account_sync_source === 'pluggyai' ? account.account_id : null;
    setProvider(pluggyId ? 'pluggyai' : 'manual');
    setProviderAccountId(pluggyId);
    if (account) {
      setName(current => (current.trim() === '' ? account.name : current));
      if (account.bankName) {
        setInstitution(current =>
          current.trim() === '' ? (account.bankName ?? current) : current,
        );
      }
    }
    if (!pluggyId) {
      setLimitsFromBank(false);
      setBankAvailable(null);
      setReadingBank(false);
      return;
    }

    setReadingBank(true);
    try {
      const preview = await send('credit-cards-preview-account', {
        accountId: next,
      });
      if (serial !== requestSerial.current) {
        return;
      }
      if (!preview || 'error' in preview || !preview.linked) {
        setBankStatus('missing');
        return;
      }
      let filled = false;
      if (preview.closingDay != null) {
        setClosingDay(String(preview.closingDay));
        filled = true;
      }
      if (preview.dueDay != null) {
        setDueDay(String(preview.dueDay));
        filled = true;
      }
      if (preview.creditLimit != null) {
        setLimit(format.forEdit(preview.creditLimit));
        setLimitEdited(false);
        setLimitsFromBank(true);
        filled = true;
      } else {
        setLimitsFromBank(false);
      }
      setBankAvailable(preview.availableLimit);
      if (preview.brand) {
        setInstitution(current =>
          current.trim() === '' ? (preview.brand ?? current) : current,
        );
      }
      setBankStatus(filled ? 'filled' : 'missing');
    } catch {
      if (serial === requestSerial.current) {
        setBankStatus('missing');
      }
    } finally {
      if (serial === requestSerial.current) {
        setReadingBank(false);
      }
    }
  }

  return (
    <Modal name="credit-card-create" containerProps={{ style: { width: 520 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Add card')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 14, padding: '0 4px 4px' }}>
            <Text
              style={{
                ...styles.smallText,
                color: theme.pageTextLight,
                lineHeight: 1.5,
              }}
            >
              <Trans>
                The card uses an account you already have. Charges stay ordinary
                transactions, and this setup only stores the billing cycle.
              </Trans>
            </Text>
            <Field label={<Trans>Account</Trans>}>
              <Select
                options={available.map(
                  account => [account.id, account.name] as const,
                )}
                value={accountId}
                defaultLabel={t('Choose an account')}
                onChange={next => {
                  void onAccount(next);
                }}
                style={{ width: '100%' }}
              />
            </Field>
            {readingBank && (
              <Notice>
                <Trans>Reading the card from the bank…</Trans>
              </Notice>
            )}
            {bankStatus === 'filled' && (
              <Notice>
                <Trans>
                  Closing day, due day and limit were filled from the current
                  bill. A purchase on the closing day still follows the choice
                  below.
                </Trans>
              </Notice>
            )}
            {bankStatus === 'missing' && (
              <Notice tone="warning">
                <Trans>
                  The bank did not return a cycle for this account. Enter the
                  days yourself.
                </Trans>
              </Notice>
            )}
            <FieldRow>
              <Field label={<Trans>Name</Trans>}>
                <Input value={name} onChangeValue={setName} />
              </Field>
              <Field label={<Trans>Institution</Trans>}>
                <Input
                  value={institution}
                  placeholder={t('Optional')}
                  onChangeValue={setInstitution}
                />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label={<Trans>Closing day</Trans>}>
                <Input
                  value={closingDay}
                  inputMode="numeric"
                  onChangeValue={setClosingDay}
                />
              </Field>
              <Field label={<Trans>Due day</Trans>}>
                <Input
                  value={dueDay}
                  inputMode="numeric"
                  onChangeValue={setDueDay}
                />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label={<Trans>A purchase made on the closing day</Trans>}>
                <Select
                  options={[
                    ['next', t('Goes on the next bill')],
                    ['current', t('Stays on the bill that is closing')],
                  ]}
                  value={policy}
                  onChange={setPolicy}
                  style={{ width: '100%' }}
                />
              </Field>
              <Field label={<Trans>Credit limit</Trans>}>
                <Input
                  value={limit}
                  inputMode="decimal"
                  placeholder={t('Optional')}
                  onChangeValue={value => {
                    setLimit(value);
                    setLimitEdited(true);
                  }}
                  style={{ textAlign: 'right' }}
                />
              </Field>
            </FieldRow>
            {createCard.error && <Failure message={createCard.error.message} />}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                marginTop: 6,
              }}
            >
              <Button style={{ marginRight: 10 }} onPress={() => state.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <InitialFocus>
                <Button
                  variant="primary"
                  isDisabled={createCard.isPending || readingBank}
                  onPress={() => {
                    const creditLimit = format.fromEdit(limit);
                    const availableLimit =
                      !limitEdited && bankAvailable != null
                        ? bankAvailable
                        : creditLimit;
                    let creditLimitSource: 'manual' | 'bank' | null = null;
                    if (creditLimit != null) {
                      creditLimitSource = 'manual';
                      if (!limitEdited && limitsFromBank) {
                        creditLimitSource = 'bank';
                      }
                    }
                    let availableLimitSource: 'manual' | 'bank' | null = null;
                    if (availableLimit != null) {
                      availableLimitSource = 'manual';
                      if (!limitEdited && bankAvailable != null) {
                        availableLimitSource = 'bank';
                      }
                    }
                    createCard.mutate(
                      {
                        accountId,
                        name: name.trim(),
                        institution: institution.trim() || null,
                        provider,
                        providerAccountId,
                        closingDay: Number(closingDay),
                        dueDay: Number(dueDay),
                        closingDayPolicy: policy,
                        creditLimit,
                        creditLimitSource,
                        availableLimit,
                        availableLimitSource,
                      },
                      {
                        onSuccess: () => {
                          state.close();
                        },
                      },
                    );
                  }}
                >
                  <Trans>Add card</Trans>
                </Button>
              </InitialFocus>
            </View>
          </View>
        </>
      )}
    </Modal>
  );
}

function FieldRow({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {children}
    </View>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <View style={{ flex: '1 1 200px' }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}
