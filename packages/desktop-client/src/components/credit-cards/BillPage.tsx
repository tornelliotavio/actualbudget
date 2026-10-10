import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { Button } from '@actual-app/components/button';
import {
  SvgCheveronLeft,
  SvgCheveronRight,
} from '@actual-app/components/icons/v1';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import { useQuery } from '@tanstack/react-query';

import { Page } from '#components/Page';
import {
  creditCardQueries,
  useConfirmBill,
  useDeleteBills,
} from '#credit-cards';
import type { CardBill, CardBillLine } from '#credit-cards';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import {
  BackLink,
  CreditCardsGate,
  Failure,
  MeterBar,
  Money,
  Notice,
  Panel,
  SourceBadge,
  Stack,
  Stat,
  StatusBadge,
  useCardDates,
} from './ui';

type LineGroup = 'purchase' | 'installment' | 'fee' | 'refund' | 'other';

export function BillPage() {
  return (
    <CreditCardsGate>
      <BillDetail />
    </CreditCardsGate>
  );
}

function BillDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dates = useCardDates();
  const { id = '', referenceMonth = '' } = useParams();
  const today = currentDay();
  const projection = useQuery(creditCardQueries.projection(id, today));

  if (projection.isError) {
    return (
      <Page header={t('Bill')}>
        <Stack>
          <BackLink to={`/credit-cards/${id}`}>
            <Trans>Back to card</Trans>
          </BackLink>
          <Failure message={projection.error.message} />
        </Stack>
      </Page>
    );
  }
  const data = projection.data;
  if (!data) {
    return (
      <Page header={t('Bill')}>
        <Stack>
          <Text style={{ color: theme.pageTextSubdued }}>
            <Trans>Loading…</Trans>
          </Text>
        </Stack>
      </Page>
    );
  }
  const index = data.bills.findIndex(
    bill => bill.referenceMonth === referenceMonth,
  );
  const bill = index >= 0 ? data.bills[index] : undefined;
  if (!bill) {
    return (
      <Page header={t('Bill')}>
        <Stack>
          <BackLink to={`/credit-cards/${id}`}>{data.card.name}</BackLink>
          <Notice>
            <Trans>There is no bill for that month.</Trans>
          </Notice>
        </Stack>
      </Page>
    );
  }
  const previous = index > 0 ? data.bills[index - 1] : undefined;
  const next =
    index < data.bills.length - 1 ? data.bills[index + 1] : undefined;
  const goTo = (target: CardBill) =>
    void navigate(`/credit-cards/${id}/bills/${target.referenceMonth}`);

  return (
    <Page
      header={t('{{month}} bill', { month: dates.month(bill.referenceMonth) })}
    >
      <Stack>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <BackLink to={`/credit-cards/${id}`}>{data.card.name}</BackLink>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              isDisabled={!previous}
              onPress={() => previous && goTo(previous)}
              aria-label={t('Previous bill')}
            >
              <SvgCheveronLeft
                style={{ width: 10, height: 10, marginRight: 4 }}
              />
              {previous ? dates.shortMonth(previous.referenceMonth) : '—'}
            </Button>
            <Button
              isDisabled={!next}
              onPress={() => next && goTo(next)}
              aria-label={t('Next bill')}
            >
              {next ? dates.shortMonth(next.referenceMonth) : '—'}
              <SvgCheveronRight
                style={{ width: 10, height: 10, marginLeft: 4 }}
              />
            </Button>
          </View>
        </View>

        <BillHero bill={bill} />
        <Reconciliation
          key={`${bill.id}:${bill.confirmedTotal}`}
          cardId={id}
          bill={bill}
          readOnly={data.readOnly}
        />
        <Charges lines={data.lines[bill.id] ?? []} />
      </Stack>
    </Page>
  );
}

function BillHero({ bill }: { bill: CardBill }) {
  const dates = useCardDates();
  return (
    <Panel>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 20,
        }}
      >
        <View style={{ gap: 8 }}>
          <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
            <Trans>Amount owed</Trans>
          </Text>
          <Money
            amount={bill.amountOwed}
            style={{
              fontSize: 34,
              fontWeight: 600,
              lineHeight: 1.1,
              color: theme.pageText,
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <StatusBadge status={bill.status} />
            <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
              <Trans>
                Closes {{ closing: dates.day(bill.closingDate) }} · due{' '}
                {{ due: dates.day(bill.dueDate) }}
              </Trans>
            </Text>
          </View>
          <Text style={{ ...styles.verySmallText, color: theme.pageTextLight }}>
            <Trans>
              Charges from {{ start: dates.day(bill.cycleStart) }} to{' '}
              {{ end: dates.day(bill.cycleEnd) }}
            </Trans>
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 32, flexWrap: 'wrap' }}>
          <Stat label={<Trans>Paid</Trans>} amount={bill.amountPaid} />
          <Stat
            label={<Trans>Left to pay</Trans>}
            amount={Math.max(bill.remaining, 0)}
          />
          {bill.minimumPayment != null && (
            <Stat
              label={<Trans>Minimum payment</Trans>}
              amount={bill.minimumPayment}
            />
          )}
        </View>
      </View>
      <MeterBar
        value={bill.amountPaid}
        total={bill.amountOwed}
        color={theme.reportsGreen}
      />
    </Panel>
  );
}

function Reconciliation({
  cardId,
  bill,
  readOnly,
}: {
  cardId: string;
  bill: CardBill;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const format = useFormat();
  const confirm = useConfirmBill();
  const remove = useDeleteBills();
  const [value, setValue] = useState(
    bill.confirmedTotal == null ? '' : format.forEdit(bill.confirmedTotal),
  );
  const parsed = format.fromEdit(value);

  return (
    <Panel title={<Trans>Bank total and transactions</Trans>}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 32 }}>
        <Stat
          label={
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Trans>Bank total</Trans>
              {bill.confirmedTotal != null && <SourceBadge source="bank" />}
            </View>
          }
          amount={bill.confirmedTotal}
        />
        <Stat
          label={<Trans>From transactions</Trans>}
          amount={bill.computedTotal}
          caption={<Trans>Charges posted in Actual</Trans>}
        />
        <Stat
          label={<Trans>With future installments</Trans>}
          amount={bill.projectedTotal}
          caption={<Trans>Including installments not posted yet</Trans>}
        />
      </View>

      <DivergenceNotice bill={bill} />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
          <Trans>Bank total for this bill</Trans>
        </Text>
        <Input
          value={value}
          inputMode="decimal"
          placeholder={t('From your statement')}
          onChangeValue={setValue}
          style={{ width: 140, textAlign: 'right' }}
        />
        <Button
          isDisabled={
            readOnly ||
            parsed == null ||
            parsed === bill.confirmedTotal ||
            confirm.isPending
          }
          onPress={() => {
            if (parsed == null) {
              return;
            }
            confirm.mutate({
              cardId,
              referenceMonth: bill.referenceMonth,
              confirmedTotal: parsed,
            });
          }}
        >
          <Trans>Save</Trans>
        </Button>
        {bill.confirmedTotal != null && (
          <Button
            isDisabled={readOnly || remove.isPending}
            onPress={() => {
              dispatch(
                pushModal({
                  modal: {
                    name: 'confirm-delete',
                    options: {
                      message: t(
                        'Remove the bank total for this bill? Transactions on the account stay. Payments linked to this bill are unlinked.',
                      ),
                      onConfirm: () => {
                        remove.mutate(
                          {
                            cardId,
                            referenceMonths: [bill.referenceMonth],
                          },
                          {
                            onSuccess: () => {
                              void navigate(`/credit-cards/${cardId}`);
                            },
                          },
                        );
                      },
                    },
                  },
                }),
              );
            }}
            style={{ color: theme.errorText }}
          >
            <Trans>Remove bill</Trans>
          </Button>
        )}
      </View>
      {confirm.error && <Failure message={confirm.error.message} />}
      {remove.error && <Failure message={remove.error.message} />}
    </Panel>
  );
}

function DivergenceNotice({ bill }: { bill: CardBill }) {
  const format = useFormat();
  if (bill.divergence == null) {
    return (
      <Notice>
        <Trans>
          The bank has not confirmed this bill yet. Until it does, the amount
          owed comes from the transactions in Actual.
        </Trans>
      </Notice>
    );
  }
  if (bill.divergence === 0) {
    return (
      <Notice>
        <Trans>The transactions in Actual match the bank total.</Trans>
      </Notice>
    );
  }
  return (
    <Notice tone="warning">
      <Trans>
        The bank total is {{ difference: format(bill.divergence, 'financial') }}{' '}
        away from the transactions in Actual. Some charges for this period may
        not have been imported yet, or may be assigned to another bill.
      </Trans>
    </Notice>
  );
}

function groupOf(line: CardBillLine): LineGroup {
  switch (line.kind) {
    case 'purchase':
      return 'purchase';
    case 'installment':
      return 'installment';
    case 'fee':
    case 'interest':
      return 'fee';
    case 'refund':
      return 'refund';
    default:
      return 'other';
  }
}

const groupTitles: Array<[LineGroup, ReactNode]> = [
  ['purchase', <Trans key="purchase">Purchases</Trans>],
  ['installment', <Trans key="installment">Installments</Trans>],
  ['fee', <Trans key="fee">Fees and interest</Trans>],
  ['refund', <Trans key="refund">Refunds</Trans>],
  ['other', <Trans key="other">Adjustments</Trans>],
];

function Charges({ lines }: { lines: CardBillLine[] }) {
  const sorted = lines.slice().sort((a, b) => a.date.localeCompare(b.date));
  const groups = groupTitles
    .map(([group, title]) => ({
      group,
      title,
      lines: sorted.filter(line => groupOf(line) === group),
    }))
    .filter(entry => entry.lines.length > 0);

  return (
    <Panel flush title={<Trans>Charges</Trans>}>
      {groups.length === 0 && (
        <Text style={{ color: theme.pageTextSubdued, padding: 16 }}>
          <Trans>
            No charges in this bill yet. Import a statement or assign
            transactions from the card page.
          </Trans>
        </Text>
      )}
      {groups.map(entry => (
        <View key={entry.group}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 16px',
              ...styles.smallText,
              fontWeight: 500,
              color: theme.tableRowHeaderText,
              backgroundColor: theme.tableRowHeaderBackground,
              borderBottom: `1px solid ${theme.tableBorder}`,
            }}
          >
            <Text>
              {entry.title}{' '}
              <Text style={{ color: theme.pageTextSubdued, fontWeight: 400 }}>
                ({entry.lines.length})
              </Text>
            </Text>
            <Money
              amount={entry.lines.reduce(
                (total, line) => total + line.owedAmount,
                0,
              )}
            />
          </View>
          {entry.lines.map(line => (
            <ChargeRow key={line.id} line={line} />
          ))}
        </View>
      ))}
    </Panel>
  );
}

function ChargeRow({ line }: { line: CardBillLine }) {
  const dates = useCardDates();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: '9px 16px',
        ...styles.smallText,
        color: line.projected ? theme.pageTextSubdued : theme.tableText,
        borderBottom: `1px solid ${theme.tableBorder}`,
      }}
    >
      <Text style={{ width: 90, flexShrink: 0, color: theme.pageTextLight }}>
        {dates.day(line.date)}
      </Text>
      <Text style={{ flex: 1, minWidth: 0, ...styles.ellipsisText }}>
        {line.description}
      </Text>
      {(line.projected || line.source !== 'imported') && (
        <SourceBadge source={line.projected ? 'projected' : line.source} />
      )}
      <View style={{ minWidth: 90, alignItems: 'flex-end' }}>
        <Money
          amount={line.owedAmount}
          style={line.projected ? { fontStyle: 'italic' } : undefined}
        />
      </View>
    </View>
  );
}
