import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import {
  SvgCheveronDown,
  SvgCheveronRight,
} from '@actual-app/components/icons/v1';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { useLocalPref } from '#hooks/useLocalPref';

type HomeSectionProps = {
  /** Remembers whether the section is collapsed on phones. */
  id: string;
  title: string;
  /** Controls on the right of the title. */
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
};

/**
 * A titled block of the overview. Each section fails on its own, and phones
 * can collapse it.
 */
export function HomeSection({
  id,
  title,
  action,
  children,
  style,
}: HomeSectionProps) {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const headingId = useId();
  const [collapsedSections = [], setCollapsedSections] = useLocalPref(
    'home.collapsedSections',
  );
  const isCollapsed = isNarrowWidth && collapsedSections.includes(id);

  const toggle = () =>
    setCollapsedSections(
      isCollapsed
        ? collapsedSections.filter(section => section !== id)
        : [...collapsedSections, id],
    );

  const heading = (
    <h2
      id={headingId}
      style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}
    >
      {title}
    </h2>
  );

  return (
    <section
      aria-labelledby={headingId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 0,
        padding: isNarrowWidth ? 12 : 16,
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        color: theme.pageText,
        ...style,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          minHeight: 28,
        }}
      >
        {isNarrowWidth ? (
          <Button
            variant="bare"
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? t('Expand {{section}}', { section: title })
                : t('Collapse {{section}}', { section: title })
            }
            onPress={toggle}
            style={{ padding: '6px 0', gap: 6, justifyContent: 'flex-start' }}
          >
            {isCollapsed ? (
              <SvgCheveronRight width={14} height={14} />
            ) : (
              <SvgCheveronDown width={14} height={14} />
            )}
            {heading}
          </Button>
        ) : (
          heading
        )}
        {!isCollapsed && action}
      </View>
      {!isCollapsed && (
        <ErrorBoundary FallbackComponent={SectionError}>
          {children}
        </ErrorBoundary>
      )}
    </section>
  );
}

function SectionError() {
  return (
    <Text style={{ color: theme.errorText }}>
      <Trans>This section could not be shown. Try reloading the page.</Trans>
    </Text>
  );
}
