import type { ReactNode } from 'react';

import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';

type ChartTooltipProps = {
  title: ReactNode;
  rows: Array<{ label: string; value: string; color: string }>;
};

/** Hover card of a chart: one row per series. */
export function ChartTooltip({ title, rows }: ChartTooltipProps) {
  return (
    <View
      style={{
        padding: '8px 10px',
        gap: 4,
        borderRadius: 4,
        backgroundColor: theme.menuBackground,
        color: theme.menuItemText,
        border: `1px solid ${theme.menuBorder}`,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
        minWidth: 140,
      }}
    >
      <Text style={{ fontWeight: 600 }}>{title}</Text>
      {rows.map(row => (
        <View
          key={row.label}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: row.color,
            }}
          />
          <Text style={{ flex: 1, ...styles.smallText }}>{row.label}</Text>
          <PrivacyFilter>
            <FinancialText>{row.value}</FinancialText>
          </PrivacyFilter>
        </View>
      ))}
    </View>
  );
}
