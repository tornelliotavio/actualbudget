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
