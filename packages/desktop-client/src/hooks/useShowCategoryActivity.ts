import { useTranslation } from 'react-i18next';

import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import * as monthUtils from '@actual-app/core/shared/months';
import type { CategoryEntity } from '@actual-app/core/types/models';

import { useLocale } from './useLocale';
import { useNavigate } from './useNavigate';

/**
 * Opens the transactions of one or more categories in a budget month. The
 * month filters on the budget date, so card charges show in the month their
 * bill is due, as they count in the budget. Phones open the category page,
 * which only takes one category.
 */
export function useShowCategoryActivity() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { isNarrowWidth } = useResponsive();

  return (
    categoryIds: CategoryEntity['id'] | Array<CategoryEntity['id']>,
    month: string,
  ) => {
    const ids = Array.isArray(categoryIds) ? categoryIds : [categoryIds];
    if (ids.length === 0) {
      return;
    }
    if (isNarrowWidth && ids.length === 1) {
      void navigate(`/categories/${ids[0]}?month=${month}`);
      return;
    }

    const filterConditions = [
      ids.length === 1
        ? { field: 'category', op: 'is', value: ids[0], type: 'id' }
        : { field: 'category', op: 'oneOf', value: ids, type: 'id' },
      {
        field: 'date',
        op: 'is',
        value: month,
        options: { month: true },
        type: 'date',
        customName: t('Budget month: {{month}}', {
          month: monthUtils.format(month, 'MMMM yyyy', locale),
        }),
        queryFilter: { budget_date: { $transform: '$month', $eq: month } },
      },
    ];
    void navigate('/accounts', {
      state: {
        goBack: true,
        filterConditions,
        categoryId: ids.length === 1 ? ids[0] : undefined,
      },
    });
  };
}
