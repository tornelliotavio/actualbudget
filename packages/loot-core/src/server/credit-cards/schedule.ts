import type { CardBillEntity, CardProfileEntity } from '#types/models';

import type { BillDateOverride, CardSchedule } from './engine/types';

function dayOf(date: string | null | undefined): number | null {
  return date ? Number(date.slice(8, 10)) : null;
}

function latestDay(
  bills: CardBillEntity[],
  field: 'closing_date_provider' | 'due_date_provider',
): number | null {
  const latest = [...bills]
    .filter(bill => bill[field])
    .sort((a, b) => b.reference_month.localeCompare(a.reference_month))[0];
  return dayOf(latest?.[field]);
}

/**
 * The card's billing rule: user overrides first, then what the bank stated
 * on the profile, then the latest bill the bank sent. `null` when the card
 * has no closing or due day yet.
 */
export function resolveSchedule(
  profile: CardProfileEntity | null,
  bills: CardBillEntity[],
): CardSchedule | null {
  const dueDay =
    profile?.due_day_user ??
    profile?.due_day_provider ??
    latestDay(bills, 'due_date_provider');
  if (dueDay == null) {
    return null;
  }
  const closingDayInNextBill = !profile?.closing_day_on_closing_bill;

  if (profile?.closing_rule === 'days_before_due') {
    const days = profile.closing_offset_user;
    return days == null
      ? null
      : {
          closing: { kind: 'days_before_due', days },
          dueDay,
          closingDayInNextBill,
        };
  }

  const closingDay =
    profile?.closing_day_user ??
    profile?.closing_day_provider ??
    latestDay(bills, 'closing_date_provider');
  if (closingDay == null) {
    return null;
  }
  return {
    closing: { kind: 'fixed_day', day: closingDay },
    dueDay,
    closingDayInNextBill,
  };
}

/** Bill dates the user or the bank stated; the user's win. */
export function billOverrides(bills: CardBillEntity[]): BillDateOverride[] {
  return bills.flatMap(bill => {
    const userStated = bill.closing_date_user || bill.due_date_user;
    const providerStated = bill.closing_date_provider || bill.due_date_provider;
    if (!userStated && !providerStated) {
      return [];
    }
    return [
      {
        referenceMonth: bill.reference_month,
        closingDate: bill.closing_date_user ?? bill.closing_date_provider,
        dueDate: bill.due_date_user ?? bill.due_date_provider,
        source: userStated ? 'user' : 'provider',
      },
    ];
  });
}
