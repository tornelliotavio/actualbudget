import { loadConfig } from '#config';

import { composeReportEmail } from './email';
import { renderReportPdf } from './pdf';
import { createResendMailer } from './resend';
import { createSmtpMailer } from './smtp';
import type { SmtpOptions } from './smtp';
import type { DailyReport } from './types';

const report: DailyReport = {
  generatedAt: '2026-11-02T10:00:00.000Z',
  today: '2026-11-02',
  month: '2026-11',
  previousMonth: '2026-10',
  totals: {
    received: 120000,
    previousReceived: 1244898,
    spent: 291300,
    previousSpent: 941219,
    credits: 4500,
    uncategorizedInflow: 5900,
    toPay: 300000,
    paid: 10000,
    overdueCount: 1,
    cash: 207947,
    leftAfterBills: -92053,
  },
  pendingBills: [
    {
      name: 'Financiamento <MT-03> — parcela',
      dueDate: '2026-10-17',
      amount: 100735,
      kind: 'schedule',
      isEstimate: false,
      status: 'overdue',
    },
    {
      name: 'Fatura Cartão Renner',
      dueDate: '2026-11-13',
      amount: 42390,
      kind: 'card',
      isEstimate: true,
      status: 'scheduled',
    },
  ],
  cards: [
    {
      name: 'Cartão Renner',
      referenceMonth: '2026-11',
      dueDate: '2026-11-13',
      status: 'closed',
      total: 42390,
      paid: 0,
      due: 42390,
      limitTotal: 1000000,
      limitUsed: 87170,
    },
  ],
  dueByMonth: [{ month: '2026-11', amount: 42390 }],
  spending: [
    {
      name: 'Moradia',
      total: 140000,
      previous: 130000,
      categories: [{ name: 'Aluguel', total: 140000, previous: 130000 }],
    },
    { name: 'Sem categoria', total: 7500, previous: 0, categories: [] },
  ],
  income: [{ name: 'RevelaGov', total: 120000, previous: 1177200 }],
  receipts: [
    {
      date: '2026-11-01',
      label: 'Cliente 🎉 com emoji',
      account: 'Inter MEI',
      category: 'RevelaGov',
      kind: 'income',
      amount: 120000,
    },
  ],
  otherReceipts: { count: 0, amount: 0 },
  accounts: [
    {
      name: 'Inter PF',
      isCard: false,
      balance: 197728,
      bankReported: 0,
      bankDifference: 197728,
    },
  ],
  notes: {
    summary: 'Tudo certo <hoje>.',
    corrections: [{ description: 'Categorizei', count: 3 }],
    questions: [
      { description: 'O que foi isso?', date: '2026-10-22', amount: -75.9 },
    ],
  },
};

describe('renderReportPdf', () => {
  it('renders a PDF', async () => {
    const pdf = await renderReportPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders an empty month', async () => {
    const pdf = await renderReportPdf({
      ...report,
      pendingBills: [],
      cards: [],
      dueByMonth: [],
      spending: [],
      income: [],
      receipts: [],
      accounts: [],
      notes: { corrections: [], questions: [] },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('flows long lists over several pages', async () => {
    const many = Array.from({ length: 80 }, (_, index) => ({
      ...report.pendingBills[0],
      name: `Conta ${index}`,
    }));
    const short = await renderReportPdf(report);
    const long = await renderReportPdf({ ...report, pendingBills: many });
    expect(long.length).toBeGreaterThan(short.length);
  });
});

describe('composeReportEmail', () => {
  it('attaches the PDF under a dated name', () => {
    const pdf = Buffer.from('%PDF-');
    const { subject, attachments } = composeReportEmail(report, pdf);
    expect(subject).toBe('Resumo financeiro 02/11: falta pagar R$ 3.000,00');
    expect(attachments).toEqual([
      { filename: 'resumo-financeiro-2026-11-02.pdf', content: pdf },
    ]);
  });

  it('escapes bank and assistant text in the HTML', () => {
    const { html, text } = composeReportEmail(report, Buffer.from(''));
    expect(html).toContain('Financiamento &lt;MT-03&gt;');
    expect(html).toContain('Tudo certo &lt;hoje&gt;.');
    expect(html).not.toContain('<MT-03>');
    expect(text).toContain('Financiamento <MT-03>');
  });

  it('says how many items need the owner', () => {
    const { text } = composeReportEmail(report, Buffer.from(''));
    expect(text).toContain('1 item precisa da sua confirmação');
  });
});

describe('createResendMailer', () => {
  const message = {
    subject: 'Assunto',
    html: '<p>Oi</p>',
    text: 'Oi',
    attachments: [{ filename: 'a.pdf', content: Buffer.from('pdf') }],
  };

  it('posts the message with the attachment in base64', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ id: 'email-1' })),
    );
    const mailer = createResendMailer({
      apiKey: 'key',
      from: 'Actual <a@b.c>',
      to: ['owner@example.com'],
      fetch,
    });

    await expect(mailer.send(message)).resolves.toEqual({ id: 'email-1' });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer key' });
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Actual <a@b.c>',
      to: ['owner@example.com'],
      subject: 'Assunto',
      html: '<p>Oi</p>',
      text: 'Oi',
      attachments: [
        { filename: 'a.pdf', content: Buffer.from('pdf').toString('base64') },
      ],
    });
  });

  it('turns a refusal into an error that keeps the key out', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Domain not verified' }), {
          status: 403,
        }),
    );
    const mailer = createResendMailer({
      apiKey: 'secret-key',
      from: 'a@b.c',
      to: ['owner@example.com'],
      fetch,
    });

    await expect(mailer.send(message)).rejects.toThrow(
      'Resend answered 403: Domain not verified',
    );
    await expect(mailer.send(message)).rejects.not.toThrow('secret-key');
  });
});

describe('createSmtpMailer', () => {
  const options: SmtpOptions = {
    host: 'smtp.example.com',
    port: 465,
    user: 'actual@example.com',
    password: 'secret-password',
    from: 'Actual <actual@example.com>',
    to: ['owner@example.com'],
  };
  const message = {
    subject: 'Assunto',
    html: '<p>Oi</p>',
    text: 'Oi',
    attachments: [{ filename: 'a.pdf', content: Buffer.from('pdf') }],
  };

  it('sends with the configured sender and recipients', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<id@example.com>' }));
    const mailer = createSmtpMailer(options, { sendMail });

    await expect(mailer.send(message)).resolves.toEqual({
      id: '<id@example.com>',
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Actual <actual@example.com>',
      to: ['owner@example.com'],
      ...message,
    });
  });

  it('explains an unreachable server', async () => {
    const failure = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const mailer = createSmtpMailer(options, {
      sendMail: async () => Promise.reject(failure),
    });

    await expect(mailer.send(message)).rejects.toThrow(
      'Could not reach smtp.example.com:465 (ETIMEDOUT)',
    );
  });

  it('explains a refused login without the password', async () => {
    const failure = Object.assign(new Error('Invalid login'), {
      code: 'EAUTH',
    });
    const mailer = createSmtpMailer(options, {
      sendMail: async () => Promise.reject(failure),
    });

    const error = await mailer.send(message).catch(e => e as Error);
    expect(String(error)).toContain('refused the login for actual@example.com');
    expect(String(error)).not.toContain('secret-password');
  });
});

describe('report email configuration', () => {
  const base = { ACTUAL_PASSWORD: 'x', ACTUAL_SERVER_URL: 'http://localhost' };
  const smtp = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'actual@example.com',
    SMTP_PASSWORD: 'secret',
    REPORT_EMAIL_TO: 'a@example.com, b@example.com',
  };

  it('is off without a provider or a recipient', () => {
    expect(loadConfig(base).report.email).toBeNull();
    expect(
      loadConfig({ ...base, ...smtp, REPORT_EMAIL_TO: '' }).report.email,
    ).toBeNull();
  });

  it('sends from the SMTP account by default, over TLS', () => {
    expect(loadConfig({ ...base, ...smtp }).report.email).toEqual({
      kind: 'smtp',
      host: 'smtp.example.com',
      port: 465,
      user: 'actual@example.com',
      password: 'secret',
      from: 'Actual <actual@example.com>',
      to: ['a@example.com', 'b@example.com'],
    });
  });

  it('prefers SMTP over Resend', () => {
    const email = loadConfig({ ...base, ...smtp, RESEND_API_KEY: 'key' }).report
      .email;
    expect(email?.kind).toBe('smtp');
  });

  it('falls back to Resend', () => {
    const email = loadConfig({
      ...base,
      RESEND_API_KEY: 'key',
      REPORT_EMAIL_TO: 'a@example.com',
    }).report.email;
    expect(email).toEqual({
      kind: 'resend',
      apiKey: 'key',
      from: 'Actual <onboarding@resend.dev>',
      to: ['a@example.com'],
    });
  });
});
