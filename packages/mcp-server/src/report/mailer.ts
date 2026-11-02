export type MailAttachment = {
  filename: string;
  content: Buffer;
};

export type MailMessage = {
  subject: string;
  html: string;
  text: string;
  attachments: MailAttachment[];
};

/** Recipients are fixed by the mailer, never chosen per message. */
export type Mailer = {
  recipients: readonly string[];
  send(message: MailMessage): Promise<{ id: string }>;
};

export type ResendOptions = {
  apiKey: string;
  from: string;
  to: readonly string[];
  fetch?: typeof globalThis.fetch;
};

const RESEND_URL = 'https://api.resend.com/emails';

export function createResendMailer({
  apiKey,
  from,
  to,
  fetch = globalThis.fetch,
}: ResendOptions): Mailer {
  return {
    recipients: to,
    async send({ subject, html, text, attachments }) {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          subject,
          html,
          text,
          attachments: attachments.map(attachment => ({
            filename: attachment.filename,
            content: attachment.content.toString('base64'),
          })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!response.ok || !body.id) {
        throw new Error(
          `Resend answered ${response.status}: ${body.message ?? 'no details'}`,
        );
      }
      return { id: body.id };
    },
  };
}
