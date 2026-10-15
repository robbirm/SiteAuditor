import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { DEMO_USER_EMAIL } from "@/lib/constants";
import { emailProvider } from "@/lib/email/send";

export const dynamic = "force-dynamic";

/**
 * Health and setup check. Reports whether the app can reach PostgreSQL,
 * whether migrations have created the tables, whether the demo is seeded and
 * whether required settings exist. Never returns secret values.
 */
export async function GET() {
  const checks = {
    authSecretSet: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32),
    appUrlSet: Boolean(process.env.APP_URL),
    databaseUrlSet: Boolean(process.env.DATABASE_URL),
    emailProvider: emailProvider() ?? "not configured",
    emailFromSet: Boolean(process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER),
    databaseReachable: false,
    tablesCreated: false,
    demoSeeded: false,
  };
  const problems: string[] = [];

  try {
    await db.$queryRaw`SELECT 1`;
    checks.databaseReachable = true;
  } catch (error) {
    problems.push(`Cannot connect to the database: ${shortError(error)}`);
  }

  if (checks.databaseReachable) {
    try {
      await db.user.count();
      checks.tablesCreated = true;
    } catch (error) {
      problems.push(`Database tables are missing. Run "npx prisma migrate deploy". (${shortError(error)})`);
    }
  }

  if (checks.tablesCreated) {
    const demo = await db.user.findUnique({ where: { email: DEMO_USER_EMAIL }, select: { id: true } });
    checks.demoSeeded = Boolean(demo);
    if (!demo) problems.push('Demo school not loaded. Run "npm run db:seed".');
  }

  if (!checks.databaseUrlSet) problems.push("DATABASE_URL is not set.");
  if (!checks.authSecretSet) problems.push("AUTH_SECRET is missing or shorter than 32 characters.");
  if (!checks.appUrlSet) problems.push("APP_URL is not set.");
  if (!emailProvider()) problems.push("Email isn't configured: set RESEND_API_KEY and EMAIL_FROM to send password resets and invitations.");
  else if (!checks.emailFromSet) problems.push("EMAIL_FROM is not set.");

  const ok = checks.databaseReachable && checks.tablesCreated && checks.authSecretSet;
  return NextResponse.json({ status: ok ? "ok" : "error", checks, problems }, { status: ok ? 200 : 503 });
}

/** First line of an error, with any connection string credentials masked. */
function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "unknown error";
  return line.replace(/\/\/[^@\s]+@/g, "//***@").slice(0, 300);
}
