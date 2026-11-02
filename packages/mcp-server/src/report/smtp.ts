import nodemailer from 'nodemailer';

import type { Mailer, MailMessage } from './mailer';

export type SmtpOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  to: readonly string[];
};

type Transport = {
  sendMail(
    message: MailMessage & { from: string; to: string[] },
  ): Promise<{ messageId: string }>;
};

const IMPLICIT_TLS_PORT = 465;
const CONNECTION_ERRORS = new Set([
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'EDNS',
]);

function createTransport({ host, port, user, password }: SmtpOptions) {
  const usesImplicitTls = port === IMPLICIT_TLS_PORT;
  return nodemailer.createTransport({
    host,
    port,
    secure: usesImplicitTls,
    requireTLS: !usesImplicitTls,
    auth: { user, pass: password },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

function explain(error: unknown, { host, port, user }: SmtpOptions) {
  const code = (error as { code?: string }).code;
  if (code === 'EAUTH') {
    return new Error(`${host} refused the login for ${user}.`);
  }
  if (code && CONNECTION_ERRORS.has(code)) {
    return new Error(
      `Could not reach ${host}:${port} (${code}). Check the host and port; on Railway, outbound SMTP needs the Pro plan.`,
    );
  }
  return error;
}

export function createSmtpMailer(
  options: SmtpOptions,
  transport: Transport = createTransport(options),
): Mailer {
  const { from, to } = options;
  return {
    recipients: to,
    async send(message) {
      try {
        const { messageId } = await transport.sendMail({
          from,
          to: [...to],
          ...message,
        });
        return { id: messageId };
      } catch (error) {
        throw explain(error, options);
      }
    },
  };
}
