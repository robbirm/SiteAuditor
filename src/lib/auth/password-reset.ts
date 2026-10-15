import "server-only";
import { db } from "@/lib/db";
import { getBaseUrl } from "@/lib/base-url";
import { generateToken, hashToken } from "./crypto";

/** Emailed links: short-lived. */
export const RESET_TTL_MINUTES = 30;
/** Links an admin creates for a team member (shared by hand): a working day. */
export const ADMIN_RESET_TTL_MINUTES = 24 * 60;
/** Most reset emails one account can trigger per hour. */
export const MAX_RESETS_PER_HOUR = 5;

/**
 * Creates a single-use reset link. Only an HMAC of the token is stored, and
 * any earlier unused links for the user stop working.
 */
export async function issuePasswordResetLink(userId: string, ttlMinutes = RESET_TTL_MINUTES, baseUrl?: string): Promise<string> {
  const token = generateToken();
  await db.$transaction([
    db.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    db.passwordResetToken.create({
      data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
    }),
  ]);
  return `${baseUrl ?? (await getBaseUrl())}/reset-password/${token}`;
}

/** Reset links issued for this user in the last hour (survives server restarts). */
export async function recentResetCount(userId: string): Promise<number> {
  return db.passwordResetToken.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } });
}

/** Returns the reset record for a raw token if it's unused and unexpired. */
export async function findValidResetToken(token: string | null | undefined) {
  if (!token || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, isDemo: true } } },
  });
  if (!record || record.usedAt || record.expiresAt < new Date() || record.user.isDemo) return null;
  return record;
}
