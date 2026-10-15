import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { FormError } from '@actual-app/components/form-error';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type { StatementFailure } from '@actual-app/core/server/credit-cards/statements/import';
import type { AccountEntity } from '@actual-app/core/types/models';
import type { TFunction } from 'i18next';

import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { addNotification } from '#notifications/notificationsSlice';
import { useDispatch } from '#redux';
import { undo } from '#undo';

import { StatementEntryList } from './StatementEntryList';
import { StatementSummary } from './StatementSummary';
import { useStatementPreview } from './useStatementPreview';
import type { StatementPreviewState } from './useStatementPreview';

type ImportCardStatementModalProps = {
  accountId: AccountEntity['id'];
  filename: string;
  onImported?: (didChange: boolean) => void;
};

function failureMessage(failure: StatementFailure, t: TFunction) {
  switch (failure.error) {
    case 'not-a-card':
      return t(
        'Turn this account into a credit card to import its statements.',
      );
    case 'unknown-issuer':
      return t(
        'This PDF is not a statement this app can read. Supported cards: {{issuers}}.',
        { issuers: (failure.supported ?? []).join(', ') },
      );
    case 'unreadable':
      return t('This statement could not be read: {{reason}}', {
        reason: failure.message ?? '',
      });
    default:
      return failure.error satisfies never;
  }
}

function stateMessage(state: StatementPreviewState, t: TFunction) {
  switch (state.status) {
    case 'loading':
      return t('Reading the statement…');
    case 'unopenable':
      return t('This file could not be opened as a PDF.');
    case 'failed':
      return failureMessage(state.failure, t);
    case 'ready':
      return null;
    default:
      return state satisfies never;
  }
}

/**
 * Imports a credit card's PDF statement: the bill's total, dates and
 * minimum, and each entry, replacing what was typed in by hand.
 */
export function ImportCardStatementModal({
  accountId,
  filename,
  onImported,
}: ImportCardStatementModalProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { isNarrowWidth } = useResponsive();
  const state = useStatementPreview(accountId, filename);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = state.status === 'ready' ? state.preview.entries : [];
  const added = entries.filter(entry => entry.status === 'new').length;
  const replaced = entries.filter(entry => entry.status === 'replaces').length;
  const hasChanges = added + replaced > 0;

  const onImport = async (close: () => void) => {
    if (state.status !== 'ready') {
      return;
    }
    setIsImporting(true);
    const result = await send('credit-card-statement-import', {
      accountId,
      text: state.text,
    });
    if ('error' in result) {
      setError(failureMessage(result, t));
      setIsImporting(false);
      return;
    }
    dispatch(
      addNotification({
        notification: {
          type: 'message',
          message: t(
            'Statement imported: {{added}} new entries, {{replaced}} replaced.',
            {
              added: result.added - result.replaced,
              replaced: result.replaced,
            },
          ),
          button: { title: t('Undo'), action: undo },
        },
      }),
    );
    onImported?.(true);
    close();
  };

  const message = stateMessage(state, t);

  return (
    <Modal name="import-card-statement">
      {({ state: modal }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={t('Import statement')} />}
            rightContent={<ModalCloseButton onPress={() => modal.close()} />}
          />
          <View style={{ gap: 14, width: isNarrowWidth ? '100%' : 640 }}>
            {state.status === 'ready' ? (
              <>
                <StatementSummary preview={state.preview} />
                <StatementEntryList entries={entries} />
                <Text
                  style={{ ...styles.smallText, color: theme.pageTextSubdued }}
                >
                  {hasChanges
                    ? t(
                        '{{added}} new entries; {{replaced}} replace entries typed in by hand, keeping their category. Payments already on the card are left as they are.',
                        { added, replaced },
                      )
                    : t(
                        'Everything on this statement is already in the account.',
                      )}
                </Text>
              </>
            ) : (
              <Text
                style={{
                  color:
                    state.status === 'loading'
                      ? theme.pageTextSubdued
                      : theme.errorText,
                }}
              >
                {message}
              </Text>
            )}
            {error && <FormError>{error}</FormError>}
            <ModalButtons>
              <Button onPress={() => modal.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="primary"
                isDisabled={!hasChanges || isImporting}
                onPress={() => onImport(() => modal.close())}
                style={{ marginLeft: 10 }}
              >
                <Trans>Import statement</Trans>
              </Button>
            </ModalButtons>
          </View>
        </>
      )}
    </Modal>
  );
}
