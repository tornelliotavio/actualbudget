import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Select } from '@actual-app/components/select';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { useQuery } from '@tanstack/react-query';

import { Checkbox } from '#components/forms';
import { creditCardQueries, useSyncPluggyCard } from '#credit-cards';

import { Failure, Money, Notice, Panel, useCardDates } from './ui';

export function SyncBankPanel({
  cardId,
  readOnly,
  onClose,
}: {
  cardId: string;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dates = useCardDates();
  const preview = useQuery(creditCardQueries.pluggyPreview(cardId));
  const sync = useSyncPluggyCard();
  const [fromMonth, setFromMonth] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [updateLimits, setUpdateLimits] = useState(true);
  const bills = preview.data?.bills ?? [];
  const months = [...new Set(bills.map(bill => bill.referenceMonth))].sort();

  const toggle = (id: string) => {
    setSelected(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id],
    );
  };

  return (
    <Panel
      flush
      title={<Trans>Bills from the bank</Trans>}
      actions={
        <Button variant="bare" onPress={onClose}>
          <Trans>Close</Trans>
        </Button>
      }
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          padding: '12px 16px',
          borderBottom: `1px solid ${theme.tableBorder}`,
        }}
      >
        <Text
          style={{
            ...styles.smallText,
            color: theme.pageTextLight,
            flex: '1 1 280px',
            lineHeight: 1.5,
          }}
        >
          <Trans>
            Check the bills to store. Older ones stay out. This does not write
            charges to the account.
          </Trans>
        </Text>
        <Select
          options={months.map(month => [month, dates.month(month)] as const)}
          value={fromMonth}
          defaultLabel={t('From month')}
          onChange={month => {
            setFromMonth(month);
            setSelected(
              bills
                .filter(bill => bill.referenceMonth >= month)
                .map(bill => bill.id),
            );
          }}
          style={{ minWidth: 160 }}
        />
        <Button
          variant="bare"
          onPress={() => {
            setFromMonth('');
            setSelected([]);
          }}
        >
          <Trans>Clear</Trans>
        </Button>
        <Button
          variant="primary"
          isDisabled={
            readOnly ||
            sync.isPending ||
            (selected.length === 0 && !updateLimits)
          }
          onPress={() => {
            sync.mutate({
              cardId,
              billIds: selected,
              updateLimits,
            });
          }}
        >
          {sync.isPending ? (
            <Trans>Importing…</Trans>
          ) : (
            <Trans count={selected.length}>
              Import {{ count: selected.length }} selected
            </Trans>
          )}
        </Button>
      </View>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          ...styles.smallText,
          color: theme.pageText,
          borderBottom: `1px solid ${theme.tableBorder}`,
        }}
      >
        <Checkbox
          checked={updateLimits}
          onChange={() => setUpdateLimits(current => !current)}
        />
        <Trans>Update credit limit and available limit</Trans>
        {preview.data?.creditLimit != null && (
          <Money amount={preview.data.creditLimit} />
        )}
      </label>

      {preview.isPending && (
        <Text style={{ color: theme.pageTextSubdued, padding: 16 }}>
          <Trans>Reading the bills from the bank…</Trans>
        </Text>
      )}
      {preview.isError && (
        <View style={{ padding: 16 }}>
          <Failure message={preview.error.message} />
        </View>
      )}
      {sync.data && (
        <View style={{ padding: '12px 16px 0' }}>
          <Notice>
            <Trans count={sync.data.bills}>
              Stored {{ count: sync.data.bills }} bills from the bank.
            </Trans>{' '}
            {sync.data.limitsUpdated && <Trans>Limits updated.</Trans>}
          </Notice>
        </View>
      )}
      {sync.error && (
        <View style={{ padding: '12px 16px 0' }}>
          <Failure message={sync.error.message} />
        </View>
      )}

      {bills.length === 0 && preview.isSuccess && (
        <Text style={{ color: theme.pageTextSubdued, padding: 16 }}>
          <Trans>The bank did not return any bills.</Trans>
        </Text>
      )}
      <View style={{ maxHeight: 360, overflow: 'auto' }}>
        {bills.map(bill => (
          <label
            key={bill.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 16px',
              cursor: 'pointer',
              ...styles.smallText,
              color: theme.tableText,
              borderBottom: `1px solid ${theme.tableBorder}`,
              backgroundColor: selected.includes(bill.id)
                ? theme.tableRowBackgroundHighlight
                : undefined,
            }}
          >
            <Checkbox
              checked={selected.includes(bill.id)}
              aria-label={t('Select {{month}}', {
                month: dates.month(bill.referenceMonth),
              })}
              onChange={() => toggle(bill.id)}
            />
            <span style={{ flex: '1 1 140px', fontWeight: 500 }}>
              {dates.month(bill.referenceMonth)}
            </span>
            <span style={{ width: 110, color: theme.pageTextLight }}>
              <Trans>Due {{ date: dates.day(bill.dueDate) }}</Trans>
            </span>
            <span style={{ width: 110, textAlign: 'right' }}>
              <Money amount={bill.totalAmount} />
            </span>
            <span
              style={{
                width: 90,
                textAlign: 'right',
                color: theme.pageTextSubdued,
              }}
            >
              {bill.alreadyStored ? <Trans>Stored</Trans> : null}
            </span>
          </label>
        ))}
      </View>
    </Panel>
  );
}
