"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/crypto";
import { authorize, ForbiddenError, NotFoundError } from "@/lib/auth/context";
import { canManageRole } from "@/lib/auth/rbac";
import { clientIp, createSession, getSession } from "@/lib/auth/session";
import {
  ADMIN_RESET_TTL_MINUTES,
  findValidResetToken,
  issuePasswordResetLink,
  MAX_RESETS_PER_HOUR,
  recentResetCount,
  RESET_TTL_MINUTES,
} from "@/lib/auth/password-reset";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { getBaseUrl } from "@/lib/base-url";
import { passwordResetEmail } from "@/lib/email/templates";
import { fromZod, toActionError, type ActionState } from "@/lib/action-result";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  formToObject,
  idSchema,
  profileSchema,
  resetPasswordSchema,
} from "@/lib/validation";

// ─── Forgotten password ──────────────────────────────────────────────────

/**
 * Emails a reset link. The response is identical (and returns in the same
 * time) whether or not the address has an account: the lookup and the email
 * happen after the response is sent, so nothing can be learned from it.
 */
export async function requestPasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZod(parsed.error);
  const { email } = parsed.data;

  if (!isEmailConfigured()) {
    return {
      error:
        "Password reset emails aren't set up on this site yet. Ask an admin in your workspace to create a reset link for you from the Team page.",
    };
  }

  const ip = clientIp(await headers()) ?? "unknown";
  const perIp = rateLimit(`reset-ip:${ip}`, 10, 60 * 60 * 1000);
  const perEmail = rateLimit(`reset-email:${email}`, 3, 15 * 60 * 1000);
  if (!perIp.ok) return { error: "Too many reset requests from your network. Please wait a while and try again." };

  const generic: ActionState = {
    ok: true,
    message: `If an account exists for ${email}, we've emailed a link to reset its password. It expires in ${RESET_TTL_MINUTES} minutes. Check your spam folder if it doesn't arrive.`,
  };
  // Quietly drop repeat requests for one address rather than revealing anything.
  if (!perEmail.ok) return generic;

  // Work out the link's host now, while the request is still in scope.
  const baseUrl = await getBaseUrl();
  after(async () => {
    try {
      const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, isDemo: true } });
      if (!user || user.isDemo) return;
      if ((await recentResetCount(user.id)) >= MAX_RESETS_PER_HOUR) {
        console.warn(`[reset] hourly limit reached for user ${user.id}`);
        return;
      }
      const url = await issuePasswordResetLink(user.id, RESET_TTL_MINUTES, baseUrl);
      const message = passwordResetEmail({ name: user.name, url, minutes: RESET_TTL_MINUTES, requestedFrom: ip === "unknown" ? null : ip });
      await sendEmail({ to: email, ...message });
    } catch (error) {
      console.error("[reset] could not send reset email", error);
    }
  });

  return generic;
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ip = clientIp(await headers()) ?? "unknown";
  if (!rateLimit(`reset-submit:${ip}`, 20, 15 * 60 * 1000).ok) {
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  const record = await findValidResetToken(formData.get("token")?.toString());
  if (!record) {
    await burnPasswordCheck("x");
    return { error: "This reset link has expired or has already been used. Request a new one." };
  }

  const parsed = resetPasswordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const consumed = await db.$transaction(async (tx) => {
      // Claim the token atomically so two simultaneous submissions can't both use it.
      const claim = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claim.count === 0) return false;
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      // Kill any other outstanding links and sign out everywhere.
      await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: new Date() } });
      await tx.session.deleteMany({ where: { userId: record.userId } });
      return true;
    });
    if (!consumed) return { error: "This reset link has expired or has already been used. Request a new one." };

    const membership = await db.membership.findFirst({
      where: { userId: record.userId },
      orderBy: { createdAt: "asc" },
      select: { organisationId: true },
    });
    if (membership) {
      await audit({
        organisationId: membership.organisationId,
        userId: record.userId,
        action: "user.password_reset",
        entityType: "user",
        entityId: record.userId,
        summary: `${record.user.name} reset their password`,
      });
    }
    await createSession(record.userId, membership?.organisationId ?? null);
  } catch (error) {
    return toActionError(error);
  }
  redirect("/dashboard?passwordReset=1");
}

/** Admins can hand a team member a reset link (works without email set up). */
export async function createMemberResetLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("member:manage");
    const membershipId = idSchema.parse(formData.get("membershipId"));
    const membership = await db.membership.findFirst({
      where: { id: membershipId, organisationId: ctx.organisation.id },
      include: { user: { select: { id: true, name: true, isDemo: true } } },
    });
    if (!membership) throw new NotFoundError("Member not found.");
    if (membership.userId === ctx.user.id) throw new ForbiddenError("Use your Account page to change your own password.");
    if (membership.user.isDemo || !canManageRole(ctx.role, membership.role)) {
      throw new ForbiddenError("You can't reset this member's password.");
    }

    const link = await issuePasswordResetLink(membership.userId, ADMIN_RESET_TTL_MINUTES);
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "member.password_reset_link",
      entityType: "user",
      entityId: membership.userId,
      summary: `${ctx.user.name} created a password reset link for ${membership.user.name}`,
    });
    return {
      ok: true,
      message: `Reset link created for ${membership.user.name}. It works once and expires in 24 hours.`,
      data: { link },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Account settings ────────────────────────────────────────────────────

async function requireRealUser() {
  const session = await getSession();
  if (!session) throw new ForbiddenError("You need to sign in to do that.");
  if (session.user.isDemo) throw new ForbiddenError("The demo account can't be changed. Create your own account to try this.");
  return session;
}

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireRealUser();
    const parsed = profileSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const { name, email, currentPassword } = parsed.data;

    const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { email: true, passwordHash: true } });
    const emailChanged = email !== user.email;
    if (emailChanged) {
      // Changing the sign-in email is sensitive: confirm with the password.
      if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
        return { fieldErrors: { currentPassword: ["Enter your current password to change your email."] } };
      }
      const taken = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (taken) return { fieldErrors: { email: ["Another account already uses this email."] } };
    }

    await db.user.update({ where: { id: session.userId }, data: { name, email } });
    revalidatePath("/", "layout");
    return { ok: true, message: emailChanged ? "Saved. Use your new email next time you sign in." : "Profile saved." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const session = await requireRealUser();
    const parsed = changePasswordSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);

    const ip = clientIp(await headers()) ?? "unknown";
    if (!rateLimit(`change-pw:${session.userId}:${ip}`, 8, 15 * 60 * 1000).ok) {
      return { error: "Too many attempts. Please wait a few minutes." };
    }

    const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { passwordHash: true } });
    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return { fieldErrors: { currentPassword: ["That isn't your current password."] } };
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await db.$transaction([
      db.user.update({ where: { id: session.userId }, data: { passwordHash } }),
      // Keep this device signed in; sign out everywhere else.
      db.session.deleteMany({ where: { userId: session.userId, id: { not: session.id } } }),
    ]);
    return { ok: true, message: "Password changed. Other devices have been signed out." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function signOutOtherSessionsAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const session = await requireRealUser();
    const { count } = await db.session.deleteMany({ where: { userId: session.userId, id: { not: session.id } } });
    revalidatePath("/settings/account");
    return { ok: true, message: count === 0 ? "No other devices were signed in." : `Signed out of ${count} other ${count === 1 ? "device" : "devices"}.` };
  } catch (error) {
    return toActionError(error);
  }
}
