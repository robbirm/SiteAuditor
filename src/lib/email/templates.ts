// Branded SchoolVerse emails. Table layout with inline styles so they render
// consistently in Outlook, Gmail and Apple Mail. Every value is escaped.

const BRAND = {
  navy: "#0D1F36",
  ink: "#0E1B2C",
  muted: "#5A6B80",
  line: "#E2E8F0",
  teal: "#0D9488",
  tealLight: "#2DC4B6",
  bg: "#F3F6F9",
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Layout = {
  preheader: string;
  heading: string;
  paragraphs: string[]; // plain text, escaped here
  button: { label: string; url: string };
  footnote: string[];
};

function layout({ preheader, heading, paragraphs, button, footnote }: Layout): string {
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:${BRAND.ink};">${escapeHtml(t)}</p>`;
  const small = (t: string) =>
    `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:${BRAND.muted};">${escapeHtml(t)}</p>`;
  const url = escapeHtml(button.url);

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
      <tr><td style="background:${BRAND.navy};border-radius:14px 14px 0 0;padding:22px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:28px;height:28px;background:${BRAND.tealLight};border-radius:7px;font-size:0;line-height:0;">&nbsp;</td>
          <td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:bold;color:#FFFFFF;letter-spacing:-0.2px;">SchoolVerse</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:#FFFFFF;padding:36px 32px 28px;border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line};">
        <h1 style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:30px;color:${BRAND.ink};">${escapeHtml(heading)}</h1>
        ${paragraphs.map(p).join("\n        ")}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr>
          <td style="border-radius:9px;background:${BRAND.teal};">
            <a href="${url}" style="display:inline-block;padding:13px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:9px;">${escapeHtml(button.label)}</a>
          </td>
        </tr></table>
        ${small("If the button doesn't work, copy this link into your browser:")}
        <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;word-break:break-all;"><a href="${url}" style="color:${BRAND.teal};">${url}</a></p>
      </td></tr>
      <tr><td style="background:#FFFFFF;border:1px solid ${BRAND.line};border-top:none;border-radius:0 0 14px 14px;padding:18px 32px 22px;">
        ${footnote.map(small).join("\n        ")}
      </td></tr>
      <tr><td align="center" style="padding:18px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:16px;color:${BRAND.muted};">
        SchoolVerse, IT estate mapping for schools.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function passwordResetEmail({ name, url, minutes, requestedFrom }: { name: string; url: string; minutes: number; requestedFrom?: string | null }) {
  const subject = "Reset your SchoolVerse password";
  const intro = `Hi ${name}, we received a request to reset the password for your SchoolVerse account.`;
  const action = `Choose a new password using the button below. The link works once and expires in ${minutes} minutes.`;
  const ignore = "If you didn't ask for this, you can ignore this email. Your password won't change.";
  const html = layout({
    preheader: `Your password reset link expires in ${minutes} minutes.`,
    heading: "Reset your password",
    paragraphs: [intro, action],
    button: { label: "Choose a new password", url },
    footnote: [ignore, ...(requestedFrom ? [`Requested from IP address ${requestedFrom}.`] : []), "For your security, SchoolVerse staff will never ask you for your password."],
  });
  const text = [intro, "", action, "", url, "", ignore].join("\n");
  return { subject, html, text };
}

export function invitationEmail({
  inviterName,
  organisationName,
  roleLabel,
  url,
  days,
}: {
  inviterName: string;
  organisationName: string;
  roleLabel: string;
  url: string;
  days: number;
}) {
  const subject = `${inviterName} invited you to ${organisationName} on SchoolVerse`;
  const intro = `${inviterName} has invited you to join ${organisationName} on SchoolVerse as ${roleLabel === "Admin" ? "an" : "a"} ${roleLabel}.`;
  const what = "SchoolVerse maps schools in 3D: rooms, equipment, cabinets and cable runs, with a searchable asset register.";
  const action = `Accept the invitation to set up your account. The link expires in ${days} days.`;
  const html = layout({
    preheader: `Join ${organisationName} on SchoolVerse.`,
    heading: `Join ${organisationName}`,
    paragraphs: [intro, what, action],
    button: { label: "Accept invitation", url },
    footnote: ["If you weren't expecting this, you can ignore this email."],
  });
  const text = [intro, "", what, "", action, "", url].join("\n");
  return { subject, html, text };
}
