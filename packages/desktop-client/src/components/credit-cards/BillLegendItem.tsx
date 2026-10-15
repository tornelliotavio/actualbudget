import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

type BillLegendItemProps = {
  label: string;
  amount: number;
  color?: string;
  textColor?: string;
};

export function BillLegendItem({
  label,
  amount,
  color,
  textColor,
}: BillLegendItemProps) {
  const format = useFormat();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
      {color && (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            backgroundColor: color,
            border:
              color === theme.tableBorder
                ? `1px solid ${theme.pageTextSubdued}`
                : undefined,
            alignSelf: 'center',
          }}
        />
      )}
      <Text style={{ ...styles.smallText, color: theme.pageTextSubdued }}>
        {label}
      </Text>
      <PrivacyFilter>
        <FinancialText style={{ color: textColor ?? theme.pageText }}>
          {format(amount, 'financial')}
        </FinancialText>
      </PrivacyFilter>
    </View>
  );
}
