import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { SvgAlertTriangle } from '@actual-app/components/icons/v2';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { Tooltip } from '@actual-app/components/tooltip';
import { View } from '@actual-app/components/view';

import { Checkbox } from '#components/forms';
import { Cell, Row, TableHeader } from '#components/table';
import { useDeleteBills } from '#credit-cards';
import type { CardBill } from '#credit-cards';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { Failure, Money, StatusBadge, useCardDates } from './ui';

const amountCell = {
  padding: '0 10px',
  alignItems: 'flex-end',
} as const;

export function BillsTable({
  cardId,
  bills,
  readOnly,
}: {
  cardId: string;
  bills: CardBill[];
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { isNarrowWidth } = useResponsive();
  const remove = useDeleteBills();
  const [selected, setSelected] = useState<string[]>([]);
  const rows = bills.slice().reverse();
  const stored = rows.filter(bill => bill.confirmedTotal != null);
  const chosen = stored.filter(bill => selected.includes(bill.referenceMonth));

  const toggle = (referenceMonth: string) => {
    setSelected(current =>
      current.includes(referenceMonth)
        ? current.filter(month => month !== referenceMonth)
        : [...current, referenceMonth],
    );
  };

  const removeSelected = () => {
    const referenceMonths = chosen.map(bill => bill.referenceMonth);
    dispatch(
      pushModal({
        modal: {
          name: 'confirm-delete',
          options: {
            message: t(
              'Remove the bank total for {{count}} bills? Transactions on the account stay. Payments linked to those bills are unlinked.',
              { count: referenceMonths.length },
            ),
            onConfirm: () => {
              remove.mutate(
                { cardId, referenceMonths },
                {
                  onSuccess: () => setSelected([]),
                },
              );
            },
          },
        },
      }),
    );
  };

  if (rows.length === 0) {
    return (
      <Text style={{ color: theme.pageTextSubdued }}>
        <Trans>No bills yet.</Trans>
      </Text>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {stored.length > 0 && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'center',
          }}
        >
          <Button
            isDisabled={readOnly || chosen.length === 0 || remove.isPending}
            onPress={removeSelected}
            style={{ color: theme.errorText }}
          >
            <Trans count={chosen.length}>
              Remove {{ count: chosen.length }} bills
            </Trans>
          </Button>
        </View>
      )}
      {remove.error && <Failure message={remove.error.message} />}
      {isNarrowWidth ? (
        <BillsList
          cardId={cardId}
          bills={rows}
          selected={selected}
          onToggle={toggle}
        />
      ) : (
        <BillsGrid
          cardId={cardId}
          bills={rows}
          selected={selected}
          onToggle={toggle}
        />
      )}
    </View>
  );
}

function BillsGrid({
  cardId,
  bills,
  selected,
  onToggle,
}: {
  cardId: string;
  bills: CardBill[];
  selected: string[];
  onToggle: (referenceMonth: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dates = useCardDates();
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <View style={styles.tableContainer}>
      <TableHeader>
        <Cell value="" width={36} />
        <Cell value={t('Bill')} width="flex" style={{ paddingLeft: 10 }} />
        <Cell value={t('Due')} width={110} />
        <Cell value={t('Status')} width={150} />
        <Cell
          value={t('Bank total')}
          width={120}
          textAlign="right"
          style={{ paddingRight: 10 }}
        />
        <Cell
          value={t('Transactions')}
          width={130}
          textAlign="right"
          style={{ paddingRight: 10 }}
        />
        <Cell
          value={t('Paid')}
          width={110}
          textAlign="right"
          style={{ paddingRight: 10 }}
        />
        <Cell
          value={t('Left to pay')}
          width={120}
          textAlign="right"
          style={{ paddingRight: 10 }}
        />
      </TableHeader>
      {bills.map(bill => (
        <Row
          key={bill.id}
          height="auto"
          collapsed
          onMouseEnter={() => setHovered(bill.id)}
          onMouseLeave={() => setHovered(null)}
          onClick={() =>
            void navigate(
              `/credit-cards/${cardId}/bills/${bill.referenceMonth}`,
            )
          }
          style={{
            cursor: 'pointer',
            fontSize: 13,
            color: theme.tableText,
            backgroundColor:
              hovered === bill.id
                ? theme.tableRowBackgroundHover
                : theme.tableBackground,
          }}
        >
          <Cell width={36} plain style={{ padding: '10px 0 10px 10px' }}>
            {bill.confirmedTotal != null && (
              <Checkbox
                checked={selected.includes(bill.referenceMonth)}
                aria-label={t('Select {{month}}', {
                  month: dates.month(bill.referenceMonth),
                })}
                onClick={event => event.stopPropagation()}
                onChange={() => onToggle(bill.referenceMonth)}
              />
            )}
          </Cell>
          <Cell width="flex" plain style={{ padding: '10px' }}>
            <Text style={{ fontWeight: 500 }}>
              {dates.month(bill.referenceMonth)}
            </Text>
          </Cell>
          <Cell width={110} plain style={{ padding: '10px 5px' }}>
            {dates.day(bill.dueDate)}
          </Cell>
          <Cell width={150} plain style={{ padding: '6px 5px' }}>
            <StatusBadge status={bill.status} />
          </Cell>
          <Cell width={120} plain style={amountCell}>
            <Money amount={bill.confirmedTotal} />
          </Cell>
          <Cell width={130} plain style={amountCell}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              {bill.divergence != null && bill.divergence !== 0 && (
                <DivergenceIcon amount={bill.divergence} />
              )}
              <Money amount={bill.computedTotal} />
            </View>
          </Cell>
          <Cell width={110} plain style={amountCell}>
            <Money amount={bill.amountPaid} />
          </Cell>
          <Cell width={120} plain style={amountCell}>
            <Money
              amount={Math.max(bill.remaining, 0)}
              style={{ fontWeight: 500 }}
            />
          </Cell>
        </Row>
      ))}
    </View>
  );
}

function DivergenceIcon({ amount }: { amount: number }) {
  const format = useFormat();
  return (
    <Tooltip
      content={
        <Text style={{ ...styles.smallText, maxWidth: 260 }}>
          <Trans>
            The bank total differs from the transactions in Actual by{' '}
            {{ amount: format(amount, 'financial') }}. Some charges may not have
            been imported yet.
          </Trans>
        </Text>
      }
      placement="top"
      style={{ ...styles.tooltip }}
    >
      <SvgAlertTriangle
        style={{ width: 12, height: 12, color: theme.warningText }}
      />
    </Tooltip>
  );
}

function BillsList({
  cardId,
  bills,
  selected,
  onToggle,
}: {
  cardId: string;
  bills: CardBill[];
  selected: string[];
  onToggle: (referenceMonth: string) => void;
}) {
  const navigate = useNavigate();
  const dates = useCardDates();
  return (
    <View
      style={{
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {bills.map(bill => (
        <View
          key={bill.id}
          style={{
            ...styles.mobileListItem,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {bill.confirmedTotal != null && (
            <Checkbox
              checked={selected.includes(bill.referenceMonth)}
              aria-label={dates.month(bill.referenceMonth)}
              onChange={() => onToggle(bill.referenceMonth)}
            />
          )}
          <Button
            variant="bare"
            onPress={() =>
              void navigate(
                `/credit-cards/${cardId}/bills/${bill.referenceMonth}`,
              )
            }
            style={{
              flex: 1,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              textAlign: 'left',
              padding: 0,
            }}
          >
            <View style={{ gap: 6 }}>
              <Text style={{ fontWeight: 500 }}>
                {dates.month(bill.referenceMonth)}
              </Text>
              <StatusBadge status={bill.status} />
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Money amount={bill.amountOwed} style={{ fontWeight: 600 }} />
              <Text
                style={{ ...styles.verySmallText, color: theme.pageTextLight }}
              >
                <Trans>Due {{ date: dates.day(bill.dueDate) }}</Trans>
              </Text>
            </View>
          </Button>
        </View>
      ))}
    </View>
  );
}
