import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgAdd } from '@actual-app/components/icons/v1';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';

import { DateSelect } from '#components/select/DateSelect';
import { useCreatePurchase, useDeletePurchase } from '#credit-cards';
import type { CardInstallment, CardPurchase } from '#credit-cards';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';

import {
  Failure,
  FieldLabel,
  MeterBar,
  Money,
  Panel,
  SourceBadge,
  useCardDates,
} from './ui';

export function InstallmentsSection({
  cardId,
  purchases,
  installments,
  readOnly,
}: {
  cardId: string;
  purchases: CardPurchase[];
  installments: CardInstallment[];
  readOnly: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const sorted = purchases
    .slice()
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));

  return (
    <View style={{ gap: 20 }}>
      {adding && (
        <PurchaseForm
          cardId={cardId}
          readOnly={readOnly}
          onDone={() => setAdding(false)}
        />
      )}
      <Panel
        flush
        title={<Trans>Installment purchases</Trans>}
        actions={
          !adding && (
            <Button isDisabled={readOnly} onPress={() => setAdding(true)}>
              <SvgAdd style={{ width: 10, height: 10, marginRight: 6 }} />
              <Trans>Add purchase</Trans>
            </Button>
          )
        }
      >
        {sorted.length === 0 ? (
          <Text style={{ color: theme.pageTextSubdued, padding: 16 }}>
            <Trans>
              No installment purchases yet. Synced cards group them
              automatically when you reconcile. A purchase added here is
              projected and never written to the account.
            </Trans>
          </Text>
        ) : (
          sorted.map(purchase => (
            <PurchaseRow
              key={purchase.id}
              purchase={purchase}
              installments={installments.filter(
                installment => installment.purchaseId === purchase.id,
              )}
              readOnly={readOnly}
            />
          ))
        )}
      </Panel>
    </View>
  );
}

function PurchaseRow({
  purchase,
  installments,
  readOnly,
}: {
  purchase: CardPurchase;
  installments: CardInstallment[];
  readOnly: boolean;
}) {
  const dates = useCardDates();
  const remove = useDeletePurchase();
  const posted = installments.filter(
    installment =>
      installment.transactionId != null ||
      installment.status === 'imported' ||
      installment.status === 'confirmed',
  );
  const remaining = installments
    .filter(installment => !posted.includes(installment))
    .reduce((sum, installment) => sum + installment.amount, 0);
  const perInstallment = installments[0]?.amount ?? 0;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
        padding: '12px 16px',
        borderTop: `1px solid ${theme.tableBorder}`,
        ':first-child': { borderTop: 0 },
      }}
    >
      <View style={{ flex: '2 1 200px', minWidth: 0, gap: 3 }}>
        <Text
          style={{
            ...styles.ellipsisText,
            fontWeight: 500,
            color: theme.tableText,
          }}
        >
          {purchase.merchant || purchase.description}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            ...styles.verySmallText,
            color: theme.pageTextLight,
          }}
        >
          <Text>{dates.day(purchase.purchaseDate)}</Text>
          {purchase.source && <SourceBadge source={purchase.source} />}
        </View>
      </View>
      <View style={{ flex: '1 1 160px', gap: 6 }}>
        <MeterBar
          value={posted.length}
          total={purchase.installmentCount}
          color={theme.reportsBlue}
          height={6}
        />
        <Text style={{ ...styles.verySmallText, color: theme.pageTextLight }}>
          <Trans>
            {{ posted: posted.length }} of{' '}
            {{ total: purchase.installmentCount }} posted
          </Trans>
          {' · '}
          <Money amount={perInstallment} /> <Trans>each</Trans>
        </Text>
      </View>
      <View style={{ width: 120, alignItems: 'flex-end', gap: 3 }}>
        <Money amount={purchase.totalAmount} style={{ fontWeight: 600 }} />
        <Text style={{ ...styles.verySmallText, color: theme.pageTextLight }}>
          <Trans>Still to come</Trans> <Money amount={remaining} />
        </Text>
      </View>
      {purchase.source === 'manual' && (
        <Button
          variant="bare"
          isDisabled={readOnly || remove.isPending}
          onPress={() => remove.mutate(purchase.id)}
          style={{ color: theme.pageTextLight }}
        >
          <Trans>Remove</Trans>
        </Button>
      )}
    </View>
  );
}

function PurchaseForm({
  cardId,
  readOnly,
  onDone,
}: {
  cardId: string;
  readOnly: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const createPurchase = useCreatePurchase();
  const [date, setDate] = useState(currentDay());
  const [merchant, setMerchant] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState('2');
  const totalAmount = format.fromEdit(total);
  const installmentCount = Number(count);
  const perInstallment =
    totalAmount != null && installmentCount > 0
      ? Math.floor(totalAmount / installmentCount)
      : null;

  return (
    <Panel title={<Trans>New installment purchase</Trans>}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ width: 140 }}>
          <FieldLabel>
            <Trans>Purchase date</Trans>
          </FieldLabel>
          <DateSelect
            value={date}
            dateFormat={dateFormat}
            onSelect={value => setDate(value)}
          />
        </View>
        <View style={{ flex: '1 1 200px' }}>
          <FieldLabel>
            <Trans>Merchant</Trans>
          </FieldLabel>
          <Input
            value={merchant}
            placeholder={t('e.g. Magazine Luiza')}
            onChangeValue={setMerchant}
          />
        </View>
        <View style={{ width: 140 }}>
          <FieldLabel>
            <Trans>Total</Trans>
          </FieldLabel>
          <Input
            value={total}
            inputMode="decimal"
            onChangeValue={setTotal}
            style={{ textAlign: 'right' }}
          />
        </View>
        <View style={{ width: 110 }}>
          <FieldLabel>
            <Trans>Installments</Trans>
          </FieldLabel>
          <Input
            value={count}
            inputMode="numeric"
            onChangeValue={setCount}
            style={{ textAlign: 'right' }}
          />
        </View>
      </View>
      <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
        {perInstallment != null ? (
          <>
            <Trans count={installmentCount}>
              {{ count: installmentCount }} installments of
            </Trans>{' '}
            <Money amount={perInstallment} />.{' '}
            <Trans>They are projected onto the coming bills.</Trans>
          </>
        ) : (
          <Trans>
            Enter the total and the number of installments to preview them.
          </Trans>
        )}
      </Text>
      {createPurchase.error && (
        <Failure message={createPurchase.error.message} />
      )}
      <View
        style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}
      >
        <Button onPress={onDone}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="primary"
          isDisabled={
            readOnly || totalAmount == null || createPurchase.isPending
          }
          onPress={() => {
            if (totalAmount == null) {
              return;
            }
            createPurchase.mutate(
              {
                cardId,
                purchaseDate: date,
                merchant: merchant.trim() || null,
                totalAmount,
                installmentCount,
              },
              { onSuccess: onDone },
            );
          }}
        >
          <Trans>Add purchase</Trans>
        </Button>
      </View>
    </Panel>
  );
}
