import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Paragraph } from '@actual-app/components/paragraph';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { currentDay } from '@actual-app/core/shared/months';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Page } from '#components/Page';
import {
  creditCardQueries,
  useAllocatePayment,
  useCreatePurchase,
  useDeleteCreditCard,
  useUpdateCreditCard,
} from '#credit-cards';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

import { AssignPanel } from './AssignPanel';
import {
  CreditCardsGate,
  Failure,
  Money,
  SourceBadge,
  Stack,
  StatusLabel,
} from './ui';

type Section = 'overview' | 'bills' | 'installments' | 'payments' | 'settings';

export function CreditCardPage() {
  return (
    <CreditCardsGate>
      <CardDetail />
    </CreditCardsGate>
  );
}

function CardDetail() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const today = currentDay();
  const projection = useQuery(creditCardQueries.projection(id, today));
  const [section, setSection] = useState<Section>('overview');
  const [assigning, setAssigning] = useState(false);

  if (projection.isError) {
    return (
      <Page header={t('Credit card')}>
        <Failure message={projection.error.message} />
      </Page>
    );
  }
  const data = projection.data;
  if (!data) {
    return (
      <Page header={t('Credit card')}>
        <Text>
          <Trans>Loading…</Trans>
        </Text>
      </Page>
    );
  }

  const { card, summary } = data;
  return (
    <Page header={card.name}>
      <Stack>
        <Link to="/credit-cards" style={{ color: theme.pageTextLink }}>
          <Trans>All cards</Trans>
        </Link>
        {data.readOnly && (
          <Text style={{ color: theme.warningText }}>
            <Trans>
              This budget uses a newer credit card schema. You can look, but not
              change anything, until the app is updated.
            </Trans>
          </Text>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <SectionButton
            section="overview"
            current={section}
            onSelect={setSection}
          />
          <SectionButton
            section="bills"
            current={section}
            onSelect={setSection}
          />
          <SectionButton
            section="installments"
            current={section}
            onSelect={setSection}
          />
          <SectionButton
            section="payments"
            current={section}
            onSelect={setSection}
          />
          <SectionButton
            section="settings"
            current={section}
            onSelect={setSection}
          />
        </View>
        {section === 'overview' && (
          <Overview
            cardId={card.id}
            accountId={card.accountId}
            summary={summary}
            creditLimit={card.creditLimit}
            availableLimit={card.availableLimit}
            readOnly={data.readOnly}
            assigning={assigning}
            onAssign={() => setAssigning(true)}
            months={data.bills.map(bill => bill.referenceMonth)}
            defaultMonth={summary.statement?.referenceMonth ?? null}
          />
        )}
        {section === 'bills' && (
          <BillList cardId={card.id} bills={data.bills} />
        )}
        {section === 'installments' && (
          <Installments
            cardId={card.id}
            purchases={data.purchases}
            installments={data.installments}
            readOnly={data.readOnly}
          />
        )}
        {section === 'payments' && (
          <Payments
            cardId={card.id}
            bills={data.bills}
            payments={data.payments}
            unlinked={data.unlinkedPayments}
            readOnly={data.readOnly}
          />
        )}
        {section === 'settings' && (
          <Settings card={card} readOnly={data.readOnly} />
        )}
      </Stack>
    </Page>
  );
}

function SectionButton({
  section,
  current,
  onSelect,
}: {
  section: Section;
  current: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <Button
      variant={section === current ? 'primary' : undefined}
      onPress={() => onSelect(section)}
    >
      <SectionName section={section} />
    </Button>
  );
}

function SectionName({ section }: { section: Section }) {
  if (section === 'overview') {
    return <Trans>Overview</Trans>;
  }
  if (section === 'bills') {
    return <Trans>Bills</Trans>;
  }
  if (section === 'installments') {
    return <Trans>Installments</Trans>;
  }
  if (section === 'payments') {
    return <Trans>Payments</Trans>;
  }
  return <Trans>Settings</Trans>;
}

function Overview({
  cardId,
  accountId,
  summary,
  creditLimit,
  availableLimit,
  readOnly,
  assigning,
  onAssign,
  months,
  defaultMonth,
}: {
  cardId: string;
  accountId: string;
  summary: {
    currentBillAmount: number;
    amountDue: number;
    amountPaid: number;
    futureCommitments: number;
    totalCommitment: number;
    accountBalance: number;
    statement: {
      referenceMonth: string;
      dueDate: string;
      status: string;
    } | null;
  };
  creditLimit: number | null;
  availableLimit: number | null;
  readOnly: boolean;
  assigning: boolean;
  onAssign: () => void;
  months: string[];
  defaultMonth: string | null;
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  return (
    <View style={{ gap: 12 }}>
      <Fact label={<Trans>Current bill</Trans>}>
        <Money amount={summary.currentBillAmount} />
      </Fact>
      <Fact label={<Trans>Due by the due date</Trans>}>
        <Money amount={summary.amountDue} />
      </Fact>
      <Fact label={<Trans>Already paid</Trans>}>
        <Money amount={summary.amountPaid} />
      </Fact>
      <Fact label={<Trans>Future commitments</Trans>}>
        <Money amount={summary.futureCommitments} />
      </Fact>
      <Fact label={<Trans>Account balance</Trans>}>
        <Money amount={summary.accountBalance} />
      </Fact>
      <Fact label={<Trans>Credit limit</Trans>}>
        <Money amount={creditLimit} />
      </Fact>
      <Fact label={<Trans>Available limit</Trans>}>
        <Money amount={availableLimit} />
      </Fact>
      {summary.statement && (
        <Text>
          <Trans>Statement status:</Trans>{' '}
          <StatusLabel status={summary.statement.status} />
        </Text>
      )}
      <Paragraph>
        <Trans>
          The account balance is Actual's own total. Limits and the bill are
          separate, and projected installments are not posted to the account.
        </Trans>
      </Paragraph>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          isDisabled={readOnly}
          onPress={async () => {
            const chosen = await window.Actual.openFileDialog({
              filters: [
                {
                  name: t('Financial files'),
                  extensions: ['qif', 'ofx', 'qfx', 'csv', 'tsv', 'xml'],
                },
              ],
            });
            if (!chosen || chosen.length === 0) {
              return;
            }
            dispatch(
              pushModal({
                modal: {
                  name: 'import-transactions',
                  options: {
                    accountId,
                    filename: chosen[0],
                    onImported: didChange => {
                      if (didChange) {
                        void queryClient.invalidateQueries({
                          queryKey: creditCardQueries.all,
                        });
                        onAssign();
                      }
                    },
                  },
                },
              }),
            );
          }}
        >
          <Trans>Import statement</Trans>
        </Button>
        <Button onPress={onAssign}>
          <Trans>Assign transactions</Trans>
        </Button>
      </View>
      {assigning && (
        <AssignPanel
          cardId={cardId}
          months={months}
          defaultMonth={defaultMonth}
          readOnly={readOnly}
        />
      )}
    </View>
  );
}

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'baseline' }}>
      <Text style={{ minWidth: 180, color: theme.pageTextLight }}>{label}</Text>
      {children}
    </View>
  );
}

function BillList({
  cardId,
  bills,
}: {
  cardId: string;
  bills: Array<{
    id: string;
    referenceMonth: string;
    dueDate: string;
    status: string;
    amountOwed: number;
    remaining: number;
    divergence: number | null;
  }>;
}) {
  return (
    <View style={{ gap: 8 }}>
      {bills.map(bill => (
        <View
          key={bill.id}
          style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}
        >
          <Link
            to={`/credit-cards/${cardId}/bills/${bill.referenceMonth}`}
            style={{ color: theme.pageTextLink }}
          >
            {bill.referenceMonth}
          </Link>
          <Text>{bill.dueDate}</Text>
          <StatusLabel status={bill.status} />
          <Money amount={bill.amountOwed} />
          {bill.divergence != null && bill.divergence !== 0 && (
            <Text style={{ color: theme.warningText }}>
              <Trans>Divergence</Trans> <Money amount={bill.divergence} />
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function Installments({
  cardId,
  purchases,
  installments,
  readOnly,
}: {
  cardId: string;
  purchases: Array<{
    id: string;
    purchaseDate: string;
    merchant: string | null;
    description: string | null;
    totalAmount: number;
    installmentCount: number;
  }>;
  installments: Array<{
    id: string;
    purchaseId: string;
    installmentNumber: number;
    amount: number;
    status: string;
    transactionId: string | null;
  }>;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const createPurchase = useCreatePurchase();
  const [date, setDate] = useState(currentDay());
  const [merchant, setMerchant] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState('1');
  return (
    <View style={{ gap: 12 }}>
      <Paragraph>
        <Trans>
          A purchase entered here is split into projected installments. Nothing
          is written to the account until a real transaction arrives or you
          import a statement.
        </Trans>
      </Paragraph>
      <Input value={date} onChangeValue={setDate} />
      <Input
        value={merchant}
        onChangeValue={setMerchant}
        placeholder={t('Merchant')}
      />
      <Input value={total} onChangeValue={setTotal} />
      <Input value={count} onChangeValue={setCount} />
      {createPurchase.error && (
        <Failure message={createPurchase.error.message} />
      )}
      <Button
        variant="primary"
        isDisabled={readOnly}
        onPress={() => {
          const totalAmount = format.fromEdit(total);
          if (totalAmount == null) {
            return;
          }
          createPurchase.mutate({
            cardId,
            purchaseDate: date,
            merchant,
            totalAmount,
            installmentCount: Number(count),
          });
        }}
      >
        <Trans>Add purchase</Trans>
      </Button>
      {purchases.map(purchase => (
        <View key={purchase.id} style={{ gap: 4 }}>
          <Text>
            {purchase.purchaseDate} {purchase.merchant || purchase.description}{' '}
            <Money amount={purchase.totalAmount} />
          </Text>
          {installments
            .filter(installment => installment.purchaseId === purchase.id)
            .map(installment => (
              <View
                key={installment.id}
                style={{ flexDirection: 'row', gap: 8, paddingLeft: 12 }}
              >
                <Text>
                  {installment.installmentNumber}/{purchase.installmentCount}
                </Text>
                <Money amount={installment.amount} />
                <SourceBadge
                  source={
                    installment.transactionId ? 'imported' : installment.status
                  }
                />
              </View>
            ))}
        </View>
      ))}
    </View>
  );
}

function Payments({
  cardId,
  bills,
  payments,
  unlinked,
  readOnly,
}: {
  cardId: string;
  bills: Array<{ id: string; referenceMonth: string }>;
  payments: Array<{
    id: string;
    billId: string;
    amount: number;
    paymentDate: string;
  }>;
  unlinked: Array<{
    id: string;
    date: string;
    amount: number;
    payeeName: string | null;
  }>;
  readOnly: boolean;
}) {
  const allocate = useAllocatePayment();
  const [billId, setBillId] = useState(bills[0]?.id ?? '');
  return (
    <View style={{ gap: 12 }}>
      <Paragraph>
        <Trans>
          Payments are transfers already in Actual. Linking one does not create
          a new expense.
        </Trans>
      </Paragraph>
      <select
        value={billId}
        onChange={event => setBillId(event.currentTarget.value)}
        style={{ height: 32 }}
      >
        {bills.map(bill => (
          <option key={bill.id} value={bill.id}>
            {bill.referenceMonth}
          </option>
        ))}
      </select>
      {unlinked.map(payment => (
        <View key={payment.id} style={{ flexDirection: 'row', gap: 8 }}>
          <Text>{payment.date}</Text>
          <Text>{payment.payeeName}</Text>
          <Money amount={payment.amount} />
          <Button
            isDisabled={readOnly || billId === ''}
            onPress={() => {
              allocate.mutate({
                cardId,
                billId,
                transactionId: payment.id,
                amount: payment.amount,
              });
            }}
          >
            <Trans>Link to bill</Trans>
          </Button>
        </View>
      ))}
      {unlinked.length === 0 && (
        <Text>
          <Trans>No unlinked payments on this card.</Trans>
        </Text>
      )}
      {payments.map(payment => (
        <View key={payment.id} style={{ flexDirection: 'row', gap: 8 }}>
          <Text>{payment.paymentDate}</Text>
          <Money amount={payment.amount} />
          <SourceBadge source="manual" />
        </View>
      ))}
      {allocate.error && <Failure message={allocate.error.message} />}
    </View>
  );
}

function Settings({
  card,
  readOnly,
}: {
  card: {
    id: string;
    name: string;
    closingDay: number;
    dueDay: number;
    closingDayPolicy: 'current' | 'next';
    creditLimit: number | null;
    availableLimit: number | null;
  };
  readOnly: boolean;
}) {
  const format = useFormat();
  const navigate = useNavigate();
  const update = useUpdateCreditCard();
  const remove = useDeleteCreditCard();
  const [name, setName] = useState(card.name);
  const [closingDay, setClosingDay] = useState(String(card.closingDay));
  const [dueDay, setDueDay] = useState(String(card.dueDay));
  const [policy, setPolicy] = useState(card.closingDayPolicy);
  const [limit, setLimit] = useState(
    card.creditLimit == null ? '' : format.forEdit(card.creditLimit),
  );
  const [available, setAvailable] = useState(
    card.availableLimit == null ? '' : format.forEdit(card.availableLimit),
  );
  return (
    <View style={{ gap: 8, maxWidth: 360 }}>
      <Input value={name} onChangeValue={setName} />
      <Input value={closingDay} onChangeValue={setClosingDay} />
      <Input value={dueDay} onChangeValue={setDueDay} />
      <select
        value={policy}
        onChange={event => {
          const next = event.currentTarget.value;
          if (next === 'current' || next === 'next') {
            setPolicy(next);
          }
        }}
        style={{ height: 32 }}
      >
        <PolicyOptions />
      </select>
      <Input value={limit} onChangeValue={setLimit} />
      <Input value={available} onChangeValue={setAvailable} />
      {update.error && <Failure message={update.error.message} />}
      <Button
        variant="primary"
        isDisabled={readOnly}
        onPress={() => {
          const creditLimit = format.fromEdit(limit);
          const availableLimit = format.fromEdit(available);
          update.mutate({
            id: card.id,
            name,
            closingDay: Number(closingDay),
            dueDay: Number(dueDay),
            closingDayPolicy: policy,
            creditLimit,
            creditLimitSource: creditLimit == null ? null : 'manual',
            availableLimit,
            availableLimitSource: availableLimit == null ? null : 'manual',
          });
        }}
      >
        <Trans>Save</Trans>
      </Button>
      <Button
        isDisabled={readOnly}
        onPress={() => {
          remove.mutate(card.id, {
            onSuccess: () => {
              void navigate('/credit-cards');
            },
          });
        }}
      >
        <Trans>Remove card</Trans>
      </Button>
      <Paragraph>
        <Trans>
          Removing the card drops its billing metadata. The account and its
          transactions stay.
        </Trans>
      </Paragraph>
    </View>
  );
}

function PolicyOptions() {
  return (
    <>
      <option value="next">
        <Trans>Goes on the next bill</Trans>
      </option>
      <option value="current">
        <Trans>Stays on this bill</Trans>
      </option>
    </>
  );
}
