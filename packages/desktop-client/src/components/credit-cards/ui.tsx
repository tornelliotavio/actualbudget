import { useEffect } from 'react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import {
  SvgCheveronLeft,
  SvgCreditCard,
} from '@actual-app/components/icons/v1';
import {
  SvgAlertTriangle,
  SvgCalendar3,
  SvgCheckCircleHollow,
  SvgValidationCheck,
} from '@actual-app/components/icons/v2';
import { ModeButton } from '@actual-app/components/mode-button';
import { SpaceBetween } from '@actual-app/components/space-between';
import { styles } from '@actual-app/components/styles';
import type { CSSProperties } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { listen } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import { tsToRelativeTime } from '@actual-app/core/shared/util';
import { useQueryClient } from '@tanstack/react-query';

import { Link } from '#components/common/Link';
import { FinancialText } from '#components/FinancialText';
import { Page } from '#components/Page';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { creditCardQueries } from '#credit-cards';
import type { CardBillStatus } from '#credit-cards';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFeatureFlag } from '#hooks/useFeatureFlag';
import { useFormat } from '#hooks/useFormat';
import { useLocale } from '#hooks/useLocale';

export function useCreditCardSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = listen('sync-event', event => {
      if (event.type !== 'applied' || !('tables' in event)) {
        return;
      }
      const tables = event.tables;
      const touched = tables.some(
        table =>
          table.startsWith('credit_card') ||
          table === 'transactions' ||
          table === 'preferences',
      );
      if (touched) {
        void queryClient.invalidateQueries({
          queryKey: creditCardQueries.all,
        });
      }
    });
    return () => {
      unlisten();
    };
  }, [queryClient]);
}

export function CreditCardsGate({ children }: { children: ReactNode }) {
  const enabled = useFeatureFlag('creditCards');
  const { t } = useTranslation();
  useCreditCardSync();
  if (!enabled) {
    return (
      <Page header={t('Credit cards')}>
        <EmptyState
          title={<Trans>Credit cards are turned off</Trans>}
          description={
            <Trans>
              Turn them on in Settings, under Experimental features.
            </Trans>
          }
        />
      </Page>
    );
  }
  return children;
}

export function useCardDates() {
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();
  return {
    day: (value: string) => monthUtils.format(value, dateFormat, locale),
    month: (referenceMonth: string) =>
      monthUtils.format(referenceMonth, 'MMMM yyyy', locale),
    shortMonth: (referenceMonth: string) =>
      monthUtils.format(referenceMonth, "MMM ''yy", locale),
    relative: (iso: string) => {
      const time = Date.parse(iso);
      if (Number.isNaN(time)) {
        return iso;
      }
      return tsToRelativeTime(String(time), locale, { capitalize: true });
    },
  };
}

export function Money({
  amount,
  style,
}: {
  amount: number | null;
  style?: CSSProperties;
}) {
  const format = useFormat();
  if (amount == null) {
    return (
      <Text style={{ color: theme.pageTextSubdued, ...style }}>
        <Trans>Not available</Trans>
      </Text>
    );
  }
  return (
    <PrivacyFilter>
      <FinancialText style={style}>{format(amount, 'financial')}</FinancialText>
    </PrivacyFilter>
  );
}

export function Stack({ children }: { children: ReactNode }) {
  return (
    // View's minHeight of 0 lets a column shrink to the viewport, so the
    // panels compress instead of extending the page. The inner block keeps
    // its height and this scroller moves.
    <View style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <View
        style={{
          flexShrink: 0,
          minHeight: 'auto',
          gap: 20,
          paddingTop: 10,
          paddingBottom: 40,
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function Panel({
  title,
  actions,
  children,
  flush = false,
  style,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  style?: CSSProperties;
}) {
  return (
    <View
      style={{
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title || actions) && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            padding: '12px 16px',
            borderBottom: `1px solid ${theme.tableBorder}`,
          }}
        >
          <Text style={{ ...styles.mediumText, color: theme.tableText }}>
            {title}
          </Text>
          {actions}
        </View>
      )}
      <View style={{ padding: flush ? 0 : 16, gap: flush ? 0 : 12 }}>
        {children}
      </View>
    </View>
  );
}

export function Stat({
  label,
  amount,
  caption,
  size = 'medium',
  style,
}: {
  label: ReactNode;
  amount: number | null;
  caption?: ReactNode;
  size?: 'medium' | 'large';
  style?: CSSProperties;
}) {
  return (
    <View style={{ gap: 4, minWidth: 0, ...style }}>
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>
      <Money
        amount={amount}
        style={{
          fontSize: size === 'large' ? 30 : 20,
          fontWeight: 600,
          color: theme.pageText,
          lineHeight: 1.2,
        }}
      />
      {caption && (
        <Text style={{ ...styles.smallText, color: theme.pageTextLight }}>
          {caption}
        </Text>
      )}
    </View>
  );
}

export function MeterBar({
  value,
  total,
  color,
  height = 8,
}: {
  value: number;
  total: number;
  color: string;
  height?: number;
}) {
  const ratio = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  return (
    <View
      role="meter"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: theme.tableBorder,
        overflow: 'hidden',
        flexDirection: 'row',
      }}
    >
      <View
        style={{
          width: `${ratio * 100}%`,
          backgroundColor: color,
          borderRadius: height / 2,
          transition: 'background-color .25s',
        }}
      />
    </View>
  );
}

export function usageColor(used: number, total: number) {
  const ratio = total > 0 ? used / total : 0;
  if (ratio >= 0.9) {
    return theme.reportsRed;
  }
  if (ratio >= 0.75) {
    return theme.warningText;
  }
  return theme.reportsBlue;
}

type StatusStyle = {
  color: string;
  backgroundColor: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
};

function statusStyle(status: CardBillStatus): StatusStyle {
  switch (status) {
    case 'paid':
      return {
        color: theme.noticeText,
        backgroundColor: theme.noticeBackgroundLight,
        Icon: SvgValidationCheck,
      };
    case 'partially_paid':
      return {
        color: theme.warningTextDark,
        backgroundColor: theme.warningBackground,
        Icon: SvgAlertTriangle,
      };
    case 'overdue':
      return {
        color: theme.errorTextDarker,
        backgroundColor: theme.errorBackground,
        Icon: SvgAlertTriangle,
      };
    case 'closed':
      return {
        color: theme.upcomingText,
        backgroundColor: theme.upcomingBackground,
        Icon: SvgCalendar3,
      };
    case 'open':
      return {
        color: theme.tableRowHeaderText,
        backgroundColor: theme.tableRowHeaderBackground,
        Icon: SvgCheckCircleHollow,
      };
    default:
      return {
        color: theme.buttonNormalDisabledText,
        backgroundColor: theme.tableRowHeaderBackground,
        Icon: SvgCheckCircleHollow,
      };
  }
}

export function statusChartColor(status: CardBillStatus) {
  switch (status) {
    case 'paid':
      return theme.reportsGreen;
    case 'overdue':
      return theme.reportsRed;
    case 'open':
      return theme.reportsGray;
    default:
      return theme.reportsBlue;
  }
}

export function StatusBadge({ status }: { status: CardBillStatus }) {
  const { color, backgroundColor, Icon } = statusStyle(status);
  return (
    <View
      style={{
        color,
        backgroundColor,
        padding: '4px 7px',
        borderRadius: 4,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        flexShrink: 0,
        fontSize: 12,
      }}
    >
      <Icon style={{ width: 12, height: 12, marginRight: 6 }} />
      <Text style={{ lineHeight: '1em' }}>
        <StatusLabel status={status} />
      </Text>
    </View>
  );
}

export function StatusLabel({ status }: { status: CardBillStatus }) {
  if (status === 'open') {
    return <Trans>Open</Trans>;
  }
  if (status === 'closed') {
    return <Trans>Closed</Trans>;
  }
  if (status === 'partially_paid') {
    return <Trans>Partially paid</Trans>;
  }
  if (status === 'paid') {
    return <Trans>Paid</Trans>;
  }
  if (status === 'overdue') {
    return <Trans>Overdue</Trans>;
  }
  return <Trans>Cancelled</Trans>;
}

export function SourceBadge({ source }: { source: string }) {
  return (
    <Text
      style={{
        ...styles.editorPill,
        fontSize: 11,
        lineHeight: '1em',
        color: theme.pillText,
        flexShrink: 0,
      }}
    >
      <SourceLabel source={source} />
    </Text>
  );
}

function SourceLabel({ source }: { source: string }) {
  if (source === 'bank' || source === 'pluggyai') {
    return <Trans>From bank</Trans>;
  }
  if (source === 'computed') {
    return <Trans>From transactions</Trans>;
  }
  if (source === 'projected') {
    return <Trans>Projected</Trans>;
  }
  if (source === 'manual') {
    return <Trans>Manual</Trans>;
  }
  if (source === 'imported') {
    return <Trans>Imported</Trans>;
  }
  if (source === 'rule') {
    return <Trans>Matched</Trans>;
  }
  return <Trans>Pending</Trans>;
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'error';
  children: ReactNode;
}) {
  const palette = {
    info: {
      color: theme.upcomingText,
      backgroundColor: theme.upcomingBackground,
      borderColor: theme.upcomingBorder,
    },
    warning: {
      color: theme.warningTextDark,
      backgroundColor: theme.warningBackground,
      borderColor: theme.warningBorder,
    },
    error: {
      color: theme.errorTextDarker,
      backgroundColor: theme.errorBackground,
      borderColor: theme.errorBorder,
    },
  }[tone];
  return (
    <View
      style={{
        ...styles.smallText,
        ...palette,
        borderWidth: 1,
        borderStyle: 'solid',
        borderRadius: 4,
        padding: '8px 12px',
        lineHeight: 1.5,
      }}
    >
      {children}
    </View>
  );
}

export function Failure({ message }: { message: string }) {
  return (
    <Notice tone="error">
      <FailureText message={message} />
    </Notice>
  );
}

function FailureText({ message }: { message: string }) {
  if (message === 'upgrade-required') {
    return (
      <Trans>
        This budget uses a newer credit card schema. Update the app before
        changing cards.
      </Trans>
    );
  }
  if (message === 'not-found') {
    return <Trans>That card could not be found.</Trans>;
  }
  if (message === 'invalid-cycle') {
    return <Trans>Closing day and due day must be between 1 and 31.</Trans>;
  }
  if (message === 'invalid-month') {
    return <Trans>Choose a bill month.</Trans>;
  }
  if (message === 'invalid-amount' || message === 'invalid-limit') {
    return <Trans>Enter a valid amount.</Trans>;
  }
  if (message === 'invalid-installments') {
    return <Trans>Use between 1 and 48 installments.</Trans>;
  }
  if (message === 'not-a-payment') {
    return <Trans>Choose a payment that arrived on the card.</Trans>;
  }
  if (message === 'unknown-account' || message === 'account-required') {
    return <Trans>Choose an account.</Trans>;
  }
  if (message === 'name-required') {
    return <Trans>Give the card a name.</Trans>;
  }
  if (message === 'not-linked') {
    return <Trans>This card is not linked to a bank account.</Trans>;
  }
  if (message === 'unauthorized' || message === 'no-server') {
    return <Trans>Connect to the sync server to read the bank.</Trans>;
  }
  return <Trans>Something went wrong.</Trans>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 10,
        padding: '48px 20px',
        border: `1px dashed ${theme.tableBorder}`,
        borderRadius: 6,
        marginTop: 10,
      }}
    >
      <SvgCreditCard
        style={{ width: 36, height: 36, color: theme.pageTextSubdued }}
      />
      <Text style={{ ...styles.mediumText, color: theme.pageText }}>
        {title}
      </Text>
      {description && (
        <Text
          style={{
            ...styles.smallText,
            color: theme.pageTextLight,
            maxWidth: 420,
            lineHeight: 1.5,
          }}
        >
          {description}
        </Text>
      )}
      {action}
    </View>
  );
}

export function BackLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      variant="internal"
      to={to}
      style={{
        color: theme.pageTextLink,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        alignSelf: 'flex-start',
        textDecoration: 'none',
        ':hover': { textDecoration: 'underline' },
      }}
    >
      <SvgCheveronLeft style={{ width: 10, height: 10 }} />
      {children}
    </Link>
  );
}

export function SectionTabs<Section extends string>({
  sections,
  current,
  onSelect,
}: {
  sections: Array<[Section, ReactNode]>;
  current: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <SpaceBetween
      gap={5}
      style={{
        borderBottom: `1px solid ${theme.tableBorder}`,
        paddingBottom: 10,
      }}
    >
      {sections.map(([section, label]) => (
        <ModeButton
          key={section}
          selected={section === current}
          onSelect={() => onSelect(section)}
          style={{ backgroundColor: 'inherit', borderRadius: 4 }}
        >
          {label}
        </ModeButton>
      ))}
    </SpaceBetween>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 4,
        ...styles.smallText,
        color: theme.pageTextLight,
      }}
    >
      {children}
    </View>
  );
}
