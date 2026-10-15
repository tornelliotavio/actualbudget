import { useEffect, useState } from 'react';

import { send } from '@actual-app/core/platform/client/connection';
import type {
  StatementFailure,
  StatementPreview,
} from '@actual-app/core/server/credit-cards/statements/import';
import type { StatementText } from '@actual-app/core/server/credit-cards/statements/types';
import type { AccountEntity } from '@actual-app/core/types/models';

import { extractStatementText } from './extractStatementText';

export type StatementPreviewState =
  | { status: 'loading' }
  | { status: 'unopenable' }
  | { status: 'failed'; failure: StatementFailure }
  | { status: 'ready'; text: StatementText; preview: StatementPreview };

/** Reads a PDF statement and asks the server what importing it would do. */
export function useStatementPreview(
  accountId: AccountEntity['id'],
  filename: string,
): StatementPreviewState {
  const [state, setState] = useState<StatementPreviewState>({
    status: 'loading',
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<StatementPreviewState> {
      let text: StatementText;
      try {
        const bytes = await send('credit-card-statement-file', {
          filepath: filename,
        });
        text = await extractStatementText(bytes);
      } catch {
        return { status: 'unopenable' };
      }
      const result = await send('credit-card-statement-preview', {
        accountId,
        text,
      });
      return 'preview' in result
        ? { status: 'ready', text, preview: result.preview }
        : { status: 'failed', failure: result };
    }

    void load().then(next => {
      if (!cancelled) {
        setState(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, filename]);

  return state;
}
