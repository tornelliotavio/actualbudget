import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { Input } from '@actual-app/components/input';
import { Paragraph } from '@actual-app/components/paragraph';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { useQuery } from '@tanstack/react-query';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import { creditCardQueries, useCreateCreditCard } from '#credit-cards';
import { useAccounts } from '#hooks/useAccounts';
import { useFormat } from '#hooks/useFormat';

import { Failure } from './ui';

const selectStyle = {
  height: 32,
  fontSize: 14,
};

export function CreateCardModal() {
  const { t } = useTranslation();
  const format = useFormat();
  const accounts = useAccounts();
  const cards = useQuery(creditCardQueries.list());
  const createCard = useCreateCreditCard();
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [closingDay, setClosingDay] = useState('10');
  const [dueDay, setDueDay] = useState('17');
  const [policy, setPolicy] = useState<'next' | 'current'>('next');
  const [limit, setLimit] = useState('');

  const used = new Set((cards.data ?? []).map(card => card.accountId));
  const available = (accounts.data ?? []).filter(
    account => account.closed === 0 && !used.has(account.id),
  );

  return (
    <Modal name="credit-card-create">
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Add card')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 12, padding: 4 }}>
            <Paragraph>
              <Trans>
                The card uses an account you already have. Charges stay ordinary
                transactions, and this setup only stores the billing cycle.
              </Trans>
            </Paragraph>
            <Field label={<Trans>Account</Trans>}>
              <select
                value={accountId}
                style={selectStyle}
                onChange={event => {
                  const next = event.currentTarget.value;
                  setAccountId(next);
                  const account = available.find(item => item.id === next);
                  if (account && name.trim() === '') {
                    setName(account.name);
                  }
                }}
              >
                <option value=""><Trans>Choose an account</Trans></option>
                {available.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={<Trans>Name</Trans>}>
              <Input value={name} onChangeValue={setName} />
            </Field>
            <Field label={<Trans>Institution</Trans>}>
              <Input value={institution} onChangeValue={setInstitution} />
            </Field>
            <Field label={<Trans>Closing day</Trans>}>
              <Input value={closingDay} onChangeValue={setClosingDay} />
            </Field>
            <Field label={<Trans>Due day</Trans>}>
              <Input value={dueDay} onChangeValue={setDueDay} />
            </Field>
            <Field label={<Trans>Purchase on the closing day</Trans>}>
              <select
                value={policy}
                style={selectStyle}
                onChange={event => {
                  const next = event.currentTarget.value;
                  if (next === 'current' || next === 'next') {
                    setPolicy(next);
                  }
                }}
              >
                <option value="next">
                  <Trans>Goes on the next bill</Trans>
                </option>
                <option value="current">
                  <Trans>Stays on this bill</Trans>
                </option>
              </select>
            </Field>
            <Field label={<Trans>Credit limit</Trans>}>
              <Input
                value={limit}
                placeholder={t('Optional')}
                onChangeValue={setLimit}
              />
            </Field>
            {createCard.error && <Failure message={createCard.error.message} />}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Button style={{ marginRight: 10 }} onPress={() => state.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <InitialFocus>
                <Button
                  variant="primary"
                  isDisabled={createCard.isPending}
                  onPress={() => {
                    const creditLimit = format.fromEdit(limit);
                    createCard.mutate(
                      {
                        accountId,
                        name: name.trim(),
                        institution: institution.trim() || null,
                        provider: 'manual',
                        closingDay: Number(closingDay),
                        dueDay: Number(dueDay),
                        closingDayPolicy: policy,
                        creditLimit,
                        creditLimitSource:
                          creditLimit == null ? null : 'manual',
                        availableLimit: creditLimit,
                        availableLimitSource:
                          creditLimit == null ? null : 'manual',
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

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text>{label}</Text>
      {children}
    </View>
  );
}
