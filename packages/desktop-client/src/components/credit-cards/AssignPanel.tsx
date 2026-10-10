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
import { creditCardQueries, useAssignTransactions } from '#credit-cards';

import { Failure, Money, Notice, Panel, useCardDates } from './ui';

type AssignPanelProps = {
  cardId: string;
  months: string[];
  defaultMonth: string | null;
  readOnly: boolean;
  onClose: () => void;
};

export function AssignPanel({
  cardId,
  months,
  defaultMonth,
  readOnly,
  onClose,
}: AssignPanelProps) {
  const { t } = useTranslation();
  const dates = useCardDates();
  const transactions = useQuery(creditCardQueries.transactions(cardId));
  const assign = useAssignTransactions();
  const [month, setMonth] = useState(defaultMonth ?? months.at(-1) ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const rows = (transactions.data ?? [])
    .filter(transaction => !transaction.transferId)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 40);
  const allSelected = rows.length > 0 && selected.length === rows.length;

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
      title={<Trans>Assign transactions to a bill</Trans>}
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
            flex: '1 1 260px',
          }}
        >
          <Trans>
            Choose the bill the selected charges belong to. A description such
            as PARC 02/06 is recorded as an installment and is not added again.
          </Trans>
        </Text>
        <Select
          options={months
            .slice()
            .reverse()
            .map(item => [item, dates.month(item)] as const)}
          value={month}
          defaultLabel={t('Choose a bill')}
          onChange={setMonth}
          style={{ minWidth: 160 }}
        />
        <Button
          variant="primary"
          isDisabled={
            readOnly ||
            selected.length === 0 ||
            !/^\d{4}-\d{2}$/.test(month) ||
            assign.isPending
          }
          onPress={() => {
            assign.mutate(
              {
                cardId,
                billId: `${cardId}:${month}`,
                transactionIds: selected,
              },
              {
                onSuccess: () => {
                  setSelected([]);
                },
              },
            );
          }}
        >
          <Trans count={selected.length}>
            Assign {{ count: selected.length }} selected
          </Trans>
        </Button>
      </View>

      {assign.data && (
        <View style={{ padding: '12px 16px 0' }}>
          <Notice>
            <Trans count={assign.data.assigned.length}>
              Assigned {{ count: assign.data.assigned.length }} transactions.
            </Trans>
          </Notice>
        </View>
      )}
      {assign.error && (
        <View style={{ padding: '12px 16px 0' }}>
          <Failure message={assign.error.message} />
        </View>
      )}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: '8px 16px',
          ...styles.smallText,
          fontWeight: 500,
          color: theme.tableHeaderText,
          backgroundColor: theme.tableHeaderBackground,
          borderBottom: `1px solid ${theme.tableBorder}`,
        }}
      >
        <Checkbox
          checked={allSelected}
          aria-label={t('Select all')}
          onChange={() =>
            setSelected(
              allSelected ? [] : rows.map(transaction => transaction.id),
            )
          }
        />
        <span style={{ width: 90 }}>
          <Trans>Date</Trans>
        </span>
        <span style={{ flex: 1 }}>
          <Trans>Description</Trans>
        </span>
        <span>
          <Trans>Amount</Trans>
        </span>
      </View>
      {rows.length === 0 && (
        <Text style={{ color: theme.pageTextSubdued, padding: 16 }}>
          <Trans>No transactions on this account yet.</Trans>
        </Text>
      )}
      {rows.map(transaction => (
        <label
          key={transaction.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 16px',
            cursor: 'pointer',
            ...styles.smallText,
            color: theme.tableText,
            borderBottom: `1px solid ${theme.tableBorder}`,
            backgroundColor: selected.includes(transaction.id)
              ? theme.tableRowBackgroundHighlight
              : undefined,
          }}
        >
          <Checkbox
            checked={selected.includes(transaction.id)}
            onChange={() => toggle(transaction.id)}
          />
          <span style={{ width: 90, color: theme.pageTextLight }}>
            {dates.day(transaction.date)}
          </span>
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {transaction.payeeName || transaction.notes}
          </span>
          <Money amount={transaction.amount} />
        </label>
      ))}
    </Panel>
  );
}
