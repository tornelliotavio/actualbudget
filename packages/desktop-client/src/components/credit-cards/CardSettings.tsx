import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import type { CSSProperties } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useDeleteCreditCard, useUpdateCreditCard } from '#credit-cards';
import type { CreditCard } from '#credit-cards';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { Failure, FieldLabel, Panel, SourceBadge } from './ui';

export function CardSettings({
  card,
  readOnly,
}: {
  card: CreditCard;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const update = useUpdateCreditCard();
  const remove = useDeleteCreditCard();
  const initialLimit =
    card.creditLimit == null ? '' : format.forEdit(card.creditLimit);
  const initialAvailable =
    card.availableLimit == null ? '' : format.forEdit(card.availableLimit);
  const [name, setName] = useState(card.name);
  const [institution, setInstitution] = useState(card.institution ?? '');
  const [closingDay, setClosingDay] = useState(String(card.closingDay));
  const [dueDay, setDueDay] = useState(String(card.dueDay));
  const [policy, setPolicy] = useState(card.closingDayPolicy);
  const [limit, setLimit] = useState(initialLimit);
  const [available, setAvailable] = useState(initialAvailable);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const creditLimit = format.fromEdit(limit);
    const availableLimit = format.fromEdit(available);
    const limitPatch =
      limit === initialLimit
        ? {}
        : {
            creditLimit,
            creditLimitSource: creditLimit == null ? null : ('manual' as const),
          };
    const availablePatch =
      available === initialAvailable
        ? {}
        : {
            availableLimit,
            availableLimitSource:
              availableLimit == null ? null : ('manual' as const),
          };
    update.mutate(
      {
        id: card.id,
        name: name.trim(),
        institution: institution.trim() || null,
        closingDay: Number(closingDay),
        dueDay: Number(dueDay),
        closingDayPolicy: policy,
        ...limitPatch,
        ...availablePatch,
      },
      {
        onSuccess: () => setSaved(true),
      },
    );
  };

  return (
    <View style={{ gap: 20, maxWidth: 640 }}>
      <Panel title={<Trans>Card</Trans>}>
        <Row>
          <Field label={<Trans>Name</Trans>}>
            <Input
              value={name}
              onChangeValue={value => {
                setName(value);
                setSaved(false);
              }}
              style={controlStyle}
            />
          </Field>
          <Field label={<Trans>Institution</Trans>}>
            <Input
              value={institution}
              onChangeValue={value => {
                setInstitution(value);
                setSaved(false);
              }}
              style={controlStyle}
            />
          </Field>
        </Row>
        <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
          {card.provider === 'pluggyai' ? (
            <Trans>Linked to the bank through Pluggy.</Trans>
          ) : (
            <Trans>Kept up to date by hand or by importing statements.</Trans>
          )}
        </Text>
      </Panel>

      <Panel title={<Trans>Billing cycle</Trans>}>
        <Row>
          <Field label={<Trans>Closing day</Trans>}>
            <Input
              value={closingDay}
              inputMode="numeric"
              onChangeValue={value => {
                setClosingDay(value);
                setSaved(false);
              }}
              style={controlStyle}
            />
          </Field>
          <Field label={<Trans>Due day</Trans>}>
            <Input
              value={dueDay}
              inputMode="numeric"
              onChangeValue={value => {
                setDueDay(value);
                setSaved(false);
              }}
              style={controlStyle}
            />
          </Field>
        </Row>
        <Field
          label={<Trans>A purchase made on the closing day</Trans>}
          style={{ flex: 'none', width: '100%' }}
        >
          <Select
            options={[
              ['next', t('Goes on the next bill')],
              ['current', t('Stays on the bill that is closing')],
            ]}
            value={policy}
            onChange={value => {
              setPolicy(value);
              setSaved(false);
            }}
            style={controlStyle}
          />
        </Field>
        <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
          <Trans>
            Days 29 to 31 fall back to the last day of shorter months.
          </Trans>
        </Text>
      </Panel>

      <Panel title={<Trans>Limits</Trans>}>
        <Row>
          <Field
            label={
              <>
                <Trans>Credit limit</Trans>
                {card.creditLimitSource && (
                  <SourceBadge source={card.creditLimitSource} />
                )}
              </>
            }
          >
            <Input
              value={limit}
              inputMode="decimal"
              onChangeValue={value => {
                setLimit(value);
                setSaved(false);
              }}
              style={amountStyle}
            />
          </Field>
          <Field
            label={
              <>
                <Trans>Available limit</Trans>
                {card.availableLimitSource && (
                  <SourceBadge source={card.availableLimitSource} />
                )}
              </>
            }
          >
            <Input
              value={available}
              inputMode="decimal"
              onChangeValue={value => {
                setAvailable(value);
                setSaved(false);
              }}
              style={amountStyle}
            />
          </Field>
        </Row>
        {card.provider === 'pluggyai' && (
          <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
            <Trans>The next sync from the bank replaces these values.</Trans>
          </Text>
        )}
      </Panel>

      {update.error && <Failure message={update.error.message} />}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 12,
        }}
      >
        {saved && !update.isPending && (
          <Text style={{ ...styles.smallText, color: theme.noticeTextLight }}>
            <Trans>Saved</Trans>
          </Text>
        )}
        <Button
          variant="primary"
          isDisabled={readOnly || update.isPending}
          onPress={save}
        >
          <Trans>Save changes</Trans>
        </Button>
      </View>

      <Panel title={<Trans>Remove card</Trans>}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <Text
            style={{
              ...styles.smallText,
              color: theme.pageTextLight,
              flex: '1 1 260px',
            }}
          >
            <Trans>
              Drops the billing cycle, bills and installment plans for this
              card. The account and its transactions stay as they are.
            </Trans>
          </Text>
          <Button
            isDisabled={readOnly || remove.isPending}
            onPress={() => {
              dispatch(
                pushModal({
                  modal: {
                    name: 'confirm-delete',
                    options: {
                      message: t(
                        'Remove {{name}}? Its bills and installment plans are removed. The account and its transactions stay.',
                        { name: card.name },
                      ),
                      onConfirm: () => {
                        remove.mutate(card.id, {
                          onSuccess: () => {
                            void navigate('/credit-cards');
                          },
                        });
                      },
                    },
                  },
                }),
              );
            }}
            style={{ color: theme.errorText, flexShrink: 0 }}
          >
            <Trans>Remove card</Trans>
          </Button>
        </View>
        {remove.error && <Failure message={remove.error.message} />}
      </Panel>
    </View>
  );
}

const controlStyle: CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
};

const amountStyle: CSSProperties = {
  ...controlStyle,
  textAlign: 'right',
};

function Row({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      {children}
    </View>
  );
}

function Field({
  label,
  children,
  style,
}: {
  label: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <View style={{ flex: '1 1 220px', minWidth: 0, maxWidth: '100%', ...style }}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </View>
  );
}
