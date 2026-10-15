/**
 * Emergency account recovery: prints a one-time password reset link for a user.
 * Useful when email isn't configured and there's no other admin to help.
 *
 *   npm run user:reset-link -- someone@example.com
 *
 * Needs DATABASE_URL, AUTH_SECRET and APP_URL (from .env) matching the live site.
 */
import { createHmac, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const secret = process.env.AUTH_SECRET;
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (!email) throw new Error("Usage: npm run user:reset-link -- someone@example.com");
  if (!secret) throw new Error("AUTH_SECRET is not set. It must match the live site's value.");

  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, isDemo: true } });
  if (!user || user.isDemo) throw new Error(`No account found for ${email}.`);

  const token = randomBytes(32).toString("base64url");
  await db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: createHmac("sha256", secret).update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  console.log(`\nReset link for ${user.name} (valid for 1 hour, works once):\n\n  ${appUrl}/reset-password/${token}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
