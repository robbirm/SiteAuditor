import "server-only";

/**
 * Transactional email. Uses Resend's HTTP API when RESEND_API_KEY is set,
 * otherwise falls back to SMTP (SMTP_HOST/SMTP_USER/SMTP_PASS). Keys are read
 * only on the server and never sent to the browser.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Prevents duplicate sends if a request is retried. */
  idempotencyKey?: string;
};

export type EmailProvider = "resend" | "smtp" | null;

export function emailProvider(): EmailProvider {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return "smtp";
  return null;
}

export const isEmailConfigured = () => emailProvider() !== null;

function fromAddress(): string {
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM;
  if (from) return from;
  if (process.env.SMTP_USER) return `SchoolVerse <${process.env.SMTP_USER}>`;
  throw new Error("EMAIL_FROM is not set. Use an address on your verified domain, e.g. SchoolVerse <no-reply@mail.example.com>.");
}

async function sendWithResend(message: EmailMessage): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Resend returns { name, message } on errors; never include the key.
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend rejected the email (${response.status}): ${detail.slice(0, 300)}`);
  }
}

async function sendWithSmtp(message: EmailMessage): Promise<void> {
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT ?? "465");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ from: fromAddress(), to: message.to, subject: message.subject, html: message.html, text: message.text });
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const provider = emailProvider();
  if (provider === "resend") return sendWithResend(message);
  if (provider === "smtp") return sendWithSmtp(message);
  throw new Error("Email isn't configured. Set RESEND_API_KEY and EMAIL_FROM.");
}
