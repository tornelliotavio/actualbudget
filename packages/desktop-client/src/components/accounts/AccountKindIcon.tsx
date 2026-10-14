import { useTranslation } from 'react-i18next';

import { SvgCreditCard } from '@actual-app/components/icons/v1';
import type { AccountEntity } from '@actual-app/core/types/models';

type AccountKindIconProps = {
  account: Pick<AccountEntity, 'kind'> | undefined;
  size?: number;
};

export function AccountKindIcon({ account, size = 11 }: AccountKindIconProps) {
  const { t } = useTranslation();
  if (account?.kind !== 'credit_card') {
    return null;
  }
  return (
    <SvgCreditCard
      aria-label={t('Credit card')}
      width={size}
      height={size}
      style={{ flexShrink: 0, marginRight: 5, opacity: 0.7 }}
    />
  );
}
