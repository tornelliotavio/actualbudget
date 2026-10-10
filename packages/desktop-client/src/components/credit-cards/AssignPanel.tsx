import { useState } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Paragraph } from '@actual-app/components/paragraph';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import { useQuery } from '@tanstack/react-query';

import { creditCardQueries, useAssignTransactions } from '#credit-cards';

import { Failure, Money } from './ui';

type AssignPanelProps = {
  cardId: string;
  months: string[];
  defaultMonth: string | null;
  readOnly: boolean;
};

export function AssignPanel({
  cardId,
  months,
  defaultMonth,
  readOnly,
}: AssignPanelProps) {
  const transactions = useQuery(creditCardQueries.transactions(cardId));
  const assign = useAssignTransactions();
  const [month, setMonth] = useState(defaultMonth ?? months[0] ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const rows = (transactions.data ?? [])
    .filter(transaction => !transaction.transferId)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 40);

  return (
    <View style={{ gap: 8 }}>
      <Paragraph>
        <Trans>
          After importing a statement, choose the bill those charges belong to.
          A description such as PARC 02/06 is marked as an installment and is
          not added again.
        </Trans>
      </Paragraph>
      <label>
        <Text>
          <Trans>Bill month</Trans>
        </Text>
        <select
          value={month}
          onChange={event => setMonth(event.currentTarget.value)}
          style={{ display: 'block', marginTop: 4, height: 32 }}
        >
          {months.map(item => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      {rows.map(transaction => {
        const checked = selected.includes(transaction.id);
        return (
          <label
            key={transaction.id}
            style={{ display: 'flex', gap: 8, alignItems: 'center' }}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => {
                setSelected(current => {
                  if (checked) {
                    return current.filter(id => id !== transaction.id);
                  }
                  return [...current, transaction.id];
                });
              }}
            />
            <Text>{transaction.date}</Text>
            <Text>{transaction.payeeName || transaction.notes}</Text>
            <Money amount={transaction.amount} />
          </label>
        );
      })}
      {assign.data && (
        <Text>
          <Trans>
            Assigned {{ count: assign.data.assigned.length }} transactions.
          </Trans>
        </Text>
      )}
      {assign.error && <Failure message={assign.error.message} />}
      <Button
        variant="primary"
        isDisabled={
          readOnly || selected.length === 0 || !/^\d{4}-\d{2}$/.test(month)
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
        <Trans>Assign to this bill</Trans>
      </Button>
    </View>
  );
}
