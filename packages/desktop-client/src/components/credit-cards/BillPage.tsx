import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import { useQuery } from '@tanstack/react-query';

import { Page } from '#components/Page';
import { creditCardQueries, useConfirmBill } from '#credit-cards';
import { useFormat } from '#hooks/useFormat';

import {
  CreditCardsGate,
  Failure,
  Money,
  SourceBadge,
  Stack,
  StatusLabel,
} from './ui';

export function BillPage() {
  return (
    <CreditCardsGate>
      <BillDetail />
    </CreditCardsGate>
  );
}

function BillDetail() {
  const { t } = useTranslation();
  const { id = '', referenceMonth = '' } = useParams();
  const today = currentDay();
  const projection = useQuery(creditCardQueries.projection(id, today));
  if (projection.isError) {
    return (
      <Page header={t('Bill')}>
        <Failure message={projection.error.message} />
      </Page>
    );
  }
  const data = projection.data;
  if (!data) {
    return (
      <Page header={t('Bill')}>
        <Text>
          <Trans>Loading…</Trans>
        </Text>
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
        <Failure message="not-found" />
      </Page>
    );
  }
  const previous = index > 0 ? data.bills[index - 1] : undefined;
  const next =
    index >= 0 && index < data.bills.length - 1
      ? data.bills[index + 1]
      : undefined;
  const lines = data.lines[bill.id] ?? [];
  return (
    <Page header={`${data.card.name} ${bill.referenceMonth}`}>
      <Stack>
        <Link to={`/credit-cards/${id}`} style={{ color: theme.pageTextLink }}>
          <Trans>Back to card</Trans>
        </Link>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {previous && (
            <Link
              to={`/credit-cards/${id}/bills/${previous.referenceMonth}`}
              style={{ color: theme.pageTextLink }}
            >
              {previous.referenceMonth}
            </Link>
          )}
          {next && (
            <Link
              to={`/credit-cards/${id}/bills/${next.referenceMonth}`}
              style={{ color: theme.pageTextLink }}
            >
              {next.referenceMonth}
            </Link>
          )}
        </View>
        <Text>
          <Trans>Due</Trans> {bill.dueDate}
        </Text>
        <StatusLabel status={bill.status} />
        <Line label={<Trans>Computed from transactions</Trans>}>
          <Money amount={bill.computedTotal} />
        </Line>
        <Line label={<Trans>Including projected installments</Trans>}>
          <Money amount={bill.projectedTotal} />
        </Line>
        <Line label={<Trans>Amount owed</Trans>}>
          <Money amount={bill.amountOwed} />
        </Line>
        <Line label={<Trans>Paid</Trans>}>
          <Money amount={bill.amountPaid} />
        </Line>
        <Line label={<Trans>Remaining</Trans>}>
          <Money amount={bill.remaining} />
        </Line>
        {bill.divergence != null && (
          <Line label={<Trans>Divergence</Trans>}>
            <Money amount={bill.divergence} />
          </Line>
        )}
        <Group
          title={<Trans>Cash purchases</Trans>}
          lines={lines}
          kind="purchase"
        />
        <Group
          title={<Trans>Installments</Trans>}
          lines={lines}
          kind="installment"
        />
        <Group
          title={<Trans>Fees and interest</Trans>}
          lines={lines}
          kind="fee"
        />
        <Group title={<Trans>Refunds</Trans>} lines={lines} kind="refund" />
        <ConfirmTotal
          cardId={id}
          referenceMonth={bill.referenceMonth}
          readOnly={data.readOnly}
          confirmed={bill.confirmedTotal}
        />
      </Stack>
    </Page>
  );
}

function Line({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Text style={{ minWidth: 220, color: theme.pageTextLight }}>{label}</Text>
      {children}
    </View>
  );
}

function Group({
  title,
  lines,
  kind,
}: {
  title: ReactNode;
  lines: Array<{
    id: string;
    date: string;
    description: string;
    owedAmount: number;
    projected: boolean;
    kind: string;
    source: string;
  }>;
  kind: string;
}) {
  const shown = lines.filter(line => {
    if (kind === 'fee') {
      return line.kind === 'fee' || line.kind === 'interest';
    }
    return line.kind === kind;
  });
  if (shown.length === 0) {
    return null;
  }
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: 600 }}>{title}</Text>
      {shown.map(line => (
        <View
          key={line.id}
          style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}
        >
          <Text>{line.date}</Text>
          <Text>{line.description}</Text>
          <Money amount={line.owedAmount} />
          <SourceBadge source={line.projected ? 'projected' : line.source} />
        </View>
      ))}
    </View>
  );
}

function ConfirmTotal({
  cardId,
  referenceMonth,
  readOnly,
  confirmed,
}: {
  cardId: string;
  referenceMonth: string;
  readOnly: boolean;
  confirmed: number | null;
}) {
  const format = useFormat();
  const confirm = useConfirmBill();
  const [value, setValue] = useState(
    confirmed == null ? '' : format.forEdit(confirmed),
  );
  return (
    <View style={{ gap: 8, maxWidth: 280 }}>
      <Text>
        <Trans>Bank-confirmed total</Trans>
      </Text>
      <Input value={value} onChangeValue={setValue} />
      {confirm.error && <Failure message={confirm.error.message} />}
      <Button
        variant="primary"
        isDisabled={readOnly}
        onPress={() => {
          const confirmedTotal = format.fromEdit(value);
          if (confirmedTotal == null) {
            return;
          }
          confirm.mutate({ cardId, referenceMonth, confirmedTotal });
        }}
      >
        <Trans>Save confirmed total</Trans>
      </Button>
    </View>
  );
}
