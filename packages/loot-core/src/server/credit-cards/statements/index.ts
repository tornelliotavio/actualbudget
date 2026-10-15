import { rennerParser } from './renner';
import { riachueloParser } from './riachuelo';
import type { StatementParser, StatementText } from './types';

/** Every issuer whose PDF statements can be imported. */
export const statementParsers: readonly StatementParser[] = [
  rennerParser,
  riachueloParser,
];

export function findStatementParser(
  text: StatementText,
): StatementParser | null {
  return statementParsers.find(parser => parser.detect(text)) ?? null;
}
