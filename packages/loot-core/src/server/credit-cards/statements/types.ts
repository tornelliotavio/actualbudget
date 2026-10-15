import type {
  Cents,
  DateString,
  InstallmentInfo,
} from '#server/credit-cards/engine/types';

/** A run of text on a statement page and where its left edge sits. */
export type StatementCell = { x: number; text: string };

/** Cells sharing a baseline, left to right. */
export type StatementLine = { cells: StatementCell[] };

/** A statement's text, page by page, each page top to bottom. */
export type StatementText = { pages: StatementLine[][] };

export type StatementEntry = {
  /** As printed: the purchase date for an installment of an older purchase. */
  date: DateString;
  description: string;
  merchant: string | null;
  /** Actual's sign: charges are negative, payments and credits positive. */
  amount: Cents;
  installment: InstallmentInfo | null;
  /** The whole purchase, when the bank prints it; negative like `amount`. */
  purchaseTotal: Cents | null;
  isPayment: boolean;
};

export type CardStatement = {
  issuer: string;
  cardLast4: string | null;
  closingDate: DateString;
  dueDate: DateString;
  /** What the bill asks for, positive when owed. */
  total: Cents;
  minimumPayment: Cents | null;
  creditLimit: Cents | null;
  availableLimit: Cents | null;
  entries: StatementEntry[];
};

/** Reads one issuer's statements. */
export type StatementParser = {
  issuer: string;
  /** Shown to the user, e.g. "Renner". */
  name: string;
  detect(text: StatementText): boolean;
  /** Throws a `StatementParseError` when a required field is missing. */
  parse(text: StatementText): CardStatement;
};

export class StatementParseError extends Error {}
