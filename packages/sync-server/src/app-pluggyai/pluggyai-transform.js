export function getDate(date) {
  return date.toISOString().split('T')[0];
}

export function isoDate(value) {
  if (!value) {
    return null;
  }
  // Bill dates come as `2023-07-20T00:00:00` with no zone; parsing them as
  // local time could move them a day.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return getDate(date);
}

/**
 * Flattens nested objects into dotted keys. `pluggy-sdk` turns ISO date
 * strings into `Date` objects, which are kept as ISO strings rather than
 * walked as objects (that would drop them, purchaseDate included).
 */
export function flattenObject(obj, prefix = '') {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    }

    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) {
        result[newKey] = value.toISOString();
      }
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

export function getPayeeName(trans) {
  if (trans.merchant && (trans.merchant.name || trans.merchant.businessName)) {
    return trans.merchant.name || trans.merchant.businessName || '';
  }

  if (trans.paymentData) {
    const { receiver, payer } = trans.paymentData;

    if (trans.type === 'DEBIT' && receiver) {
      return receiver.name || receiver.documentNumber?.value || '';
    }

    if (trans.type === 'CREDIT' && payer) {
      return payer.name || payer.documentNumber?.value || '';
    }
  }

  return '';
}

/**
 * A Pluggy transaction in the shape Actual's bank sync expects. Card
 * amounts are flipped so a purchase is negative. The date is the bank's;
 * credit card installments are dated by loot-core from their bill.
 */
export function toActualTransaction(trans, accountType) {
  const isCredit = accountType === 'CREDIT';
  const amount = isCredit ? -trans.amount : trans.amount;
  const amountInAccountCurrency =
    trans.amountInAccountCurrency == null
      ? null
      : isCredit
        ? -trans.amountInAccountCurrency
        : trans.amountInAccountCurrency;
  const transactionDate =
    trans.date instanceof Date ? trans.date : new Date(trans.date);

  const { amount: _amount, ...rest } = trans;
  const flattened = flattenObject({
    ...rest,
    ...(amountInAccountCurrency == null ? {} : { amountInAccountCurrency }),
  });

  return {
    ...flattened,
    booked: trans.status !== 'PENDING',
    date: getDate(transactionDate),
    originalDate: getDate(transactionDate),
    payeeName: getPayeeName(trans),
    notes: trans.descriptionRaw || trans.description,
    transactionAmount: {
      amount: Math.round((amountInAccountCurrency ?? amount) * 100) / 100,
      currency: trans.currencyCode,
    },
    transactionId: trans.id,
    sortOrder: transactionDate.getTime(),
  };
}

/** Amounts in reais, as Pluggy sends them; loot-core converts to cents. */
export function toActualBill(bill) {
  return {
    id: bill.id,
    dueDate: isoDate(bill.dueDate),
    closingDate: isoDate(bill.billClosingDate),
    totalAmount: bill.totalAmount,
    minimumPaymentAmount: bill.minimumPaymentAmount ?? null,
    paidAmount: (bill.payments ?? []).reduce(
      (sum, payment) => sum + (payment.amount ?? 0),
      0,
    ),
    financeCharges: (bill.financeCharges ?? []).map(charge => ({
      id: charge.id ?? null,
      type: charge.type ?? null,
      amount: charge.amount ?? null,
      currencyCode: charge.currencyCode ?? null,
    })),
    payments: (bill.payments ?? []).map(payment => ({
      id: payment.id ?? null,
      date: isoDate(payment.paymentDate),
      amount: payment.amount ?? null,
    })),
    allowsInstallments: bill.allowsInstallments ?? null,
    currency: bill.totalAmountCurrencyCode ?? null,
  };
}

export function toActualCreditData(account, connector) {
  const credit = account.creditData;
  return {
    connector: connector?.isOpenFinance ? 'open_finance' : 'direct',
    creditLimit: credit?.creditLimit ?? null,
    availableCreditLimit: credit?.availableCreditLimit ?? null,
    balanceCloseDate: isoDate(credit?.balanceCloseDate),
    balanceDueDate: isoDate(credit?.balanceDueDate),
    minimumPayment: credit?.minimumPayment ?? null,
    brand: credit?.brand ?? null,
    status: credit?.status ?? null,
    holderType: credit?.holderType ?? null,
  };
}

/** Transactions from several fetches, each id once, newest first. */
export function mergeTransactions(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const trans of list) {
      if (trans && typeof trans === 'object' && trans.id != null) {
        byId.set(trans.id, trans);
      }
    }
  }
  return [...byId.values()];
}
