"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getBaseUrl } from "@/lib/base-url";
import { rateLimit } from "@/lib/rate-limit";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { invitationEmail } from "@/lib/email/templates";
import { audit } from "@/lib/audit";
import { authorize, ForbiddenError, NotFoundError } from "@/lib/auth/context";
import { canManageRole, ROLE_LABELS } from "@/lib/auth/rbac";
import { generateToken, hashToken } from "@/lib/auth/crypto";
import { fromZod, toActionError, type ActionState } from "@/lib/action-result";
import { formToObject, idSchema, inviteSchema, ROLES } from "@/lib/validation";
import { z } from "zod";

const INVITE_TTL_DAYS = 7;

/** Creates a fresh invitation token (replacing any unaccepted one) and emails it if email is set up. */
async function issueInvitation(
  ctx: { organisation: { id: string; name: string }; user: { id: string; name: string } },
  email: string,
  role: (typeof ROLES)[number],
) {
  await db.invitation.deleteMany({ where: { organisationId: ctx.organisation.id, email, acceptedAt: null } });
  const token = generateToken();
  await db.invitation.create({
    data: {
      organisationId: ctx.organisation.id,
      email,
      role,
      tokenHash: hashToken(token),
      invitedById: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    },
  });
  const link = `${await getBaseUrl()}/invite/${token}`;

  let emailed = false;
  let emailError: string | null = null;
  if (isEmailConfigured()) {
    try {
      const message = invitationEmail({
        inviterName: ctx.user.name,
        organisationName: ctx.organisation.name,
        roleLabel: ROLE_LABELS[role],
        url: link,
        days: INVITE_TTL_DAYS,
      });
      await sendEmail({ to: email, ...message });
      emailed = true;
    } catch (error) {
      console.error("[invite] could not send invitation email", error);
      emailError = "The invitation was created but the email couldn't be sent.";
    }
  }
  return { link, emailed, emailError };
}

export async function inviteMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("member:manage");
    const parsed = inviteSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const { email, role } = parsed.data;
    if (!canManageRole(ctx.role, role)) throw new ForbiddenError("Only owners can invite other owners.");
    if (!rateLimit(`invite:${ctx.organisation.id}`, 30, 60 * 60 * 1000).ok) {
      return { error: "You've sent a lot of invitations in the last hour. Please wait a while." };
    }

    const alreadyMember = await db.membership.findFirst({
      where: { organisationId: ctx.organisation.id, user: { email } },
      select: { id: true },
    });
    if (alreadyMember) return { fieldErrors: { email: ["This person is already a member."] } };

    const { link, emailed, emailError } = await issueInvitation(ctx, email, role);
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "member.invited",
      entityType: "invitation",
      summary: `${ctx.user.name} invited ${email} as ${ROLE_LABELS[role]}`,
    });
    revalidatePath("/settings/team");
    // The raw token is only ever shown here and in the email; the database keeps a hash.
    return {
      ok: true,
      message: emailed
        ? `Invitation emailed to ${email}. It expires in ${INVITE_TTL_DAYS} days.`
        : `${emailError ?? "Invitation created."} Copy the link below and send it to ${email}.`,
      data: { link, emailed: emailed ? "yes" : "no" },
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function resendInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("member:manage");
    const id = idSchema.parse(formData.get("invitationId"));
    const invite = await db.invitation.findFirst({ where: { id, organisationId: ctx.organisation.id, acceptedAt: null } });
    if (!invite) throw new NotFoundError("Invitation not found.");
    if (!canManageRole(ctx.role, invite.role)) throw new ForbiddenError("You can't resend this invitation.");
    if (!rateLimit(`invite:${ctx.organisation.id}`, 30, 60 * 60 * 1000).ok) {
      return { error: "You've sent a lot of invitations in the last hour. Please wait a while." };
    }
    const { link, emailed, emailError } = await issueInvitation(ctx, invite.email, invite.role);
    revalidatePath("/settings/team");
    return {
      ok: true,
      message: emailed ? `Invitation sent again to ${invite.email}.` : `${emailError ?? "New link created."} Copy it below.`,
      data: { link, emailed: emailed ? "yes" : "no" },
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function revokeInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("member:manage");
    const id = idSchema.parse(formData.get("invitationId"));
    const result = await db.invitation.deleteMany({ where: { id, organisationId: ctx.organisation.id, acceptedAt: null } });
    if (result.count === 0) throw new NotFoundError("Invitation not found.");
    revalidatePath("/settings/team");
    return { ok: true, message: "Invitation revoked." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function changeMemberRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("member:manage");
    const membershipId = idSchema.parse(formData.get("membershipId"));
    const role = z.enum(ROLES).parse(formData.get("role"));

    const membership = await db.membership.findFirst({
      where: { id: membershipId, organisationId: ctx.organisation.id },
      include: { user: { select: { name: true } } },
    });
    if (!membership) throw new NotFoundError("Member not found.");
    if (membership.userId === ctx.user.id) throw new ForbiddenError("You can't change your own role.");
    if (!canManageRole(ctx.role, membership.role) || !canManageRole(ctx.role, role)) {
      throw new ForbiddenError("You can't change this member's role.");
    }
    if (membership.role === "OWNER" && role !== "OWNER") {
      const owners = await db.membership.count({ where: { organisationId: ctx.organisation.id, role: "OWNER" } });
      if (owners <= 1) throw new ForbiddenError("A workspace must keep at least one owner.");
    }

    await db.membership.update({ where: { id: membership.id }, data: { role } });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "member.role_changed",
      entityType: "membership",
      entityId: membership.id,
      summary: `${ctx.user.name} changed ${membership.user.name}'s role to ${ROLE_LABELS[role]}`,
    });
    revalidatePath("/settings/team");
    return { ok: true, message: `${membership.user.name} is now ${ROLE_LABELS[role]}.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function removeMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("member:manage");
    const membershipId = idSchema.parse(formData.get("membershipId"));
    const membership = await db.membership.findFirst({
      where: { id: membershipId, organisationId: ctx.organisation.id },
      include: { user: { select: { name: true } } },
    });
    if (!membership) throw new NotFoundError("Member not found.");
    if (membership.userId === ctx.user.id) throw new ForbiddenError("You can't remove yourself.");
    if (!canManageRole(ctx.role, membership.role)) throw new ForbiddenError("You can't remove this member.");

    await db.$transaction([
      db.membership.delete({ where: { id: membership.id } }),
      // End their sessions in this workspace immediately.
      db.session.updateMany({
        where: { userId: membership.userId, organisationId: ctx.organisation.id },
        data: { organisationId: null },
      }),
    ]);
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "member.removed",
      entityType: "membership",
      entityId: membership.id,
      summary: `${ctx.user.name} removed ${membership.user.name} from the workspace`,
    });
    revalidatePath("/settings/team");
    return { ok: true, message: `${membership.user.name} has been removed.` };
  } catch (error) {
    return toActionError(error);
  }
}
