import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import {
  SvgArrowThinLeft,
  SvgArrowThinRight,
  SvgRefresh,
} from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import * as monthUtils from '@actual-app/core/shared/months';

import { useSyncAndDownloadMutation } from '#accounts';
import { Link } from '#components/common/Link';
import { amountDue } from '#components/credit-cards/billStatus';
import { MOBILE_NAV_HEIGHT } from '#components/mobile/MobileNavTabs';
import { PullToRefresh } from '#components/mobile/PullToRefresh';
import { MobilePageHeader, Page } from '#components/Page';
import { useCategories } from '#hooks/useCategories';
import { useLocale } from '#hooks/useLocale';
import { useSelector } from '#redux';

import { BalancesSection } from './balances/BalancesSection';
import { useHomeBalances } from './balances/useHomeBalances';
import { BillsSection } from './bills/BillsSection';
import { useHomeBills } from './bills/useHomeBills';
import { ChartsSection } from './charts/ChartsSection';
import {
  CategorySpendingList,
  getMonthProgress,
} from './spending/CategorySpendingList';
import { buildMonthSpending } from './spending/spendingModel';
import {
  useBudgetSpending,
  useDailyBudgetSpending,
  useUncategorizedCount,
} from './spending/useBudgetSpending';
import { getHomeSummary } from './summary/homeSummary';
import { MonthSummary } from './summary/MonthSummary';
import { useHomeMonth } from './useHomeMonth';

/**
 * The overview a tracking budget opens on: the month's bills and what is
 * left to pay, balances, spending by category against the usual, and
 * spending over time.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { isNarrowWidth, isWideWidth } = useResponsive();
  const homeMonth = useHomeMonth();
  const { month, isCurrentMonth } = homeMonth;
  const today = monthUtils.currentDay();

  const { data: { grouped: groups } = { grouped: [] } } = useCategories();
  const { bills, totals, cards, isLoading: billsLoading } = useHomeBills(month);
  const { rows, isLoading: spendingLoading } = useBudgetSpending(month);
  const { rows: dailyRows } = useDailyBudgetSpending(month);
  const uncategorizedCount = useUncategorizedCount(month);
  const balances = useHomeBalances();
  const syncAndDownload = useSyncAndDownloadMutation();
  const isSyncing = useSelector(
    state => state.account.accountsSyncing.length > 0,
  );

  const spending = buildMonthSpending({ rows, groups, month });
  const summary = getHomeSummary({
    income: spending.income,
    spent: spending.spent,
    toPay: totals.toPay,
    incomePending: totals.incomePending,
    cashTotal: balances.cashTotal,
    isCurrentMonth,
  });
  const cardDues = cards.map(card => {
    const bill = card.bills.find(
      row => row.referenceMonth === card.currentMonth,
    );
    return {
      accountId: card.accountId,
      amountDue: bill && bill.status !== 'paid' ? amountDue(bill) : null,
      available: card.available ?? null,
    };
  });

  const sync = async () => {
    await syncAndDownload.mutateAsync({});
  };

  const sections = {
    summary: (
      <MonthSummary
        summary={summary}
        spentAverage={spending.spentAverage}
        overdueCount={totals.overdueCount}
        isCurrentMonth={isCurrentMonth}
      />
    ),
    bills: (
      <BillsSection bills={bills} totals={totals} isLoading={billsLoading} />
    ),
    balances: <BalancesSection {...balances} cardDues={cardDues} />,
    spending: (
      <CategorySpendingList
        spending={spending}
        month={month}
        monthProgress={getMonthProgress(month, today)}
        uncategorizedCount={uncategorizedCount}
        isLoading={spendingLoading}
      />
    ),
    charts: (
      <ChartsSection
        rows={rows}
        dailyRows={dailyRows}
        groups={groups}
        month={month}
        today={today}
        onSelectMonth={homeMonth.setMonth}
      />
    ),
  };

  if (isNarrowWidth) {
    return (
      <Page
        padding={0}
        header={
          <MobilePageHeader
            title={<MonthNavigation {...homeMonth} compact />}
            leftContent={
              <Link
                variant="internal"
                to="/budget"
                style={{ padding: '0 12px', ...styles.smallText }}
              >
                <Trans>Budget</Trans>
              </Link>
            }
            rightContent={
              <Button
                variant="bare"
                aria-label={t('Sync bank accounts')}
                isDisabled={isSyncing}
                onPress={() => void sync()}
                style={{ margin: 6, padding: 10 }}
              >
                <SvgRefresh width={16} height={16} />
              </Button>
            }
          />
        }
      >
        <PullToRefresh onRefresh={sync}>
          <View
            style={{
              gap: 10,
              padding: 10,
              paddingBottom: MOBILE_NAV_HEIGHT + 10,
              '& > *': { flexShrink: 0 },
            }}
          >
            {sections.summary}
            {sections.bills}
            {sections.spending}
            {sections.charts}
            {sections.balances}
          </View>
        </PullToRefresh>
      </Page>
    );
  }

  return (
    <Page
      header={
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            margin: '0 20px 12px',
          }}
        >
          <Text style={{ fontSize: 25, fontWeight: 500 }}>
            <Trans>Overview</Trans>
          </Text>
          <MonthNavigation {...homeMonth} />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              marginLeft: 'auto',
            }}
          >
            <Button isDisabled={isSyncing} onPress={() => void sync()}>
              <SvgRefresh width={13} height={13} style={{ marginRight: 6 }} />
              {isSyncing ? <Trans>Syncing...</Trans> : <Trans>Sync</Trans>}
            </Button>
            <Link variant="internal" to="/budget">
              <Trans>Open budget</Trans>
            </Link>
          </View>
        </View>
      }
    >
      <View
        style={{
          flex: 1,
          overflowY: 'auto',
          gap: 16,
          paddingBottom: 24,
          '& > *': { flexShrink: 0 },
        }}
      >
        {sections.summary}
        <View
          style={{
            display: 'grid',
            gridTemplateColumns: isWideWidth
              ? 'minmax(0, 2fr) minmax(0, 3fr)'
              : 'minmax(0, 1fr)',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <View
            style={{
              display: 'grid',
              gridTemplateColumns: isWideWidth
                ? 'minmax(0, 1fr)'
                : 'repeat(2, minmax(0, 1fr))',
              gap: 16,
              alignItems: 'start',
            }}
          >
            {sections.bills}
            {sections.balances}
          </View>
          {sections.spending}
        </View>
        {sections.charts}
      </View>
    </Page>
  );
}

type MonthNavigationProps = ReturnType<typeof useHomeMonth> & {
  compact?: boolean;
};

function MonthNavigation({
  month,
  isCurrentMonth,
  previous,
  next,
  today,
  compact = false,
}: MonthNavigationProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const label = monthUtils.format(
    month,
    compact ? "MMMM ''yy" : 'MMMM yyyy',
    locale,
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Button
        variant="bare"
        aria-label={t('Previous month')}
        onPress={previous}
        style={{ padding: compact ? 10 : 6 }}
      >
        <SvgArrowThinLeft width={15} height={15} />
      </Button>
      <Button
        variant="bare"
        aria-label={
          isCurrentMonth
            ? label
            : t('{{month}}, go to this month', { month: label })
        }
        onPress={today}
        style={{
          fontSize: compact ? 16 : 18,
          fontWeight: 500,
          padding: '4px 6px',
          ...styles.tnum,
        }}
      >
        <Text style={{ textTransform: 'capitalize' }}>{label}</Text>
      </Button>
      <Button
        variant="bare"
        aria-label={t('Next month')}
        onPress={next}
        style={{ padding: compact ? 10 : 6 }}
      >
        <SvgArrowThinRight width={15} height={15} />
      </Button>
      {!isCurrentMonth && !compact && (
        <Button
          onPress={today}
          style={{ marginLeft: 6, color: theme.pageTextLink }}
        >
          <Trans>Today</Trans>
        </Button>
      )}
    </View>
  );
}
