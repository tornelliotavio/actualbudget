const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function atNoon(day: string) {
  return new Date(`${day}T12:00:00Z`);
}

export function formatMoney(cents: number) {
  return money.format(cents / 100).replace(/\s/g, ' ');
}

/** 02/11 */
export function formatDay(day: string) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** segunda-feira, 2 de novembro de 2026 */
export function formatLongDate(day: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(atNoon(day));
}

/** novembro */
export function formatMonth(month: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    timeZone: 'UTC',
  }).format(atNoon(`${month}-15`));
}

/** nov/26 */
export function formatShortMonth(month: string) {
  const name = new Intl.DateTimeFormat('pt-BR', {
    month: 'short',
    timeZone: 'UTC',
  })
    .format(atNoon(`${month}-15`))
    .replace('.', '');
  return `${name}/${month.slice(2, 4)}`;
}

export function capitalize(text: string) {
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The owner's part of a split bill: metade, 30%. */
export function formatShare(share: number) {
  return share === 0.5 ? 'metade' : `${Math.round(share * 100)}%`;
}

export function daysUntil(from: string, to: string) {
  return Math.round(
    (atNoon(to).getTime() - atNoon(from).getTime()) / 86_400_000,
  );
}

export const BILL_STATUS_LABELS = {
  overdue: 'Atrasada',
  due: 'Vence hoje',
  upcoming: 'Vence em breve',
  open: 'Fatura aberta',
  scheduled: 'Agendada',
} as const;
