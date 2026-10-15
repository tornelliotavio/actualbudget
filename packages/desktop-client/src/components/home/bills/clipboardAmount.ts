/**
 * An amount as typed in a banking app: decimal separator of the locale, no
 * grouping, no currency symbol ("1407,53" in pt-BR).
 */
export function amountForClipboard(cents: number, locale?: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(Math.abs(cents) / 100);
}
