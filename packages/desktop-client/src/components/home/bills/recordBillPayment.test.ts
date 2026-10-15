import { send } from '@actual-app/core/platform/client/connection';

import { recordBillPayment } from './recordBillPayment';

vi.mock('@actual-app/core/platform/client/connection', () => ({
  send: vi.fn(),
}));

const payment = { amount: 140753, date: '2026-10-13', accountId: 'checking' };
const payees = [
  { id: 'to-card', transfer_acct: 'card' },
  { id: 'other', transfer_acct: undefined },
];

describe('recordBillPayment', () => {
  beforeEach(() => vi.mocked(send).mockReset());

  it('posts the schedule with the amount, date and account paid', async () => {
    await recordBillPayment(
      { scheduleId: 'card-bill', cardAccountId: 'card' },
      payment,
      payees,
    );

    expect(send).toHaveBeenCalledWith('schedule/post-transaction', {
      id: 'card-bill',
      amount: -140753,
      date: '2026-10-13',
      account: 'checking',
    });
  });

  it('records a transfer to a card no schedule pays, uncleared', async () => {
    await recordBillPayment(
      { scheduleId: null, cardAccountId: 'card' },
      payment,
      payees,
    );

    expect(send).toHaveBeenCalledWith('transactions-batch-update', {
      added: [
        expect.objectContaining({
          account: 'checking',
          payee: 'to-card',
          amount: -140753,
          date: '2026-10-13',
          cleared: false,
        }),
      ],
    });
  });

  it('refuses a card without a transfer payee', async () => {
    await expect(
      recordBillPayment(
        { scheduleId: null, cardAccountId: 'missing' },
        payment,
        payees,
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
