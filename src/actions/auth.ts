"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { burnPasswordCheck, hashPassword, hashToken, verifyPassword } from "@/lib/auth/crypto";
import { clientIp, createSession, destroySession, getSession, setSessionOrganisation } from "@/lib/auth/session";
import { fromZod, isRedirectError, toActionError, type ActionState } from "@/lib/action-result";
import { formToObject, idSchema, loginSchema, organisationSchema, registerSchema } from "@/lib/validation";
import { slugify } from "@/lib/utils";
import { DEMO_USER_EMAIL } from "@/lib/constants";

async function ipKey(): Promise<string> {
  return clientIp(await headers()) ?? "unknown";
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

async function uniqueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const base = slugify(name) || "workspace";
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
    const exists = await tx.organisation.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${base}-${randomBytes(6).toString("hex")}`;
}

/** Looks up a still-valid invitation by its raw token. */
async function findOpenInvitation(token: string | null | undefined) {
  if (!token || token.length > 128) return null;
  const invite = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organisation: { select: { id: true, name: true } } },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null;
  return invite;
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const limit = rateLimit(`register:${await ipKey()}`, 5, 60 * 60 * 1000);
  if (!limit.ok) return { error: `Too many sign-up attempts. Try again in ${Math.ceil(limit.retryAfterSec / 60)} minutes.` };

  const raw = formToObject(formData);
  const invite = await findOpenInvitation(raw.invite);
  if (raw.invite && !invite) return { error: "This invitation link has expired or has already been used." };

  // Invited users join an existing organisation, so no organisation name is needed.
  const parsed = registerSchema.safeParse({ ...raw, organisationName: invite ? invite.organisation.name : raw.organisationName });
  if (!parsed.success) return fromZod(parsed.error);
  const { name, email, password, organisationName } = parsed.data;

  if (invite && invite.email !== email) {
    return { fieldErrors: { email: ["Use the email address this invitation was sent to."] }, error: "Email doesn't match the invitation." };
  }

  try {
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return { fieldErrors: { email: ["An account with this email already exists. Sign in instead."] } };
    }

    const passwordHash = await hashPassword(password);
    const { userId, organisationId } = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email, passwordHash } });

      if (invite) {
        await tx.membership.create({ data: { userId: user.id, organisationId: invite.organisationId, role: invite.role } });
        await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
        await audit(
          { organisationId: invite.organisationId, userId: user.id, action: "member.joined", entityType: "user", entityId: user.id, summary: `${name} joined the workspace` },
          tx,
        );
        return { userId: user.id, organisationId: invite.organisationId };
      }

      const org = await tx.organisation.create({
        data: { name: organisationName, slug: await uniqueSlug(tx, organisationName) },
      });
      await tx.membership.create({ data: { userId: user.id, organisationId: org.id, role: "OWNER" } });
      await audit(
        { organisationId: org.id, userId: user.id, action: "org.created", entityType: "organisation", entityId: org.id, summary: `${name} created the ${org.name} workspace` },
        tx,
      );
      return { userId: user.id, organisationId: org.id };
    });

    await createSession(userId, organisationId);
  } catch (error) {
    return toActionError(error);
  }
  redirect(invite ? "/dashboard?joined=1" : "/dashboard?welcome=1");
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZod(parsed.error);
  const { email, password } = parsed.data;

  const ip = await ipKey();
  const perIp = rateLimit(`login-ip:${ip}`, 30, 15 * 60 * 1000);
  const perAccount = rateLimit(`login:${email}`, 8, 15 * 60 * 1000);
  if (!perIp.ok || !perAccount.ok) {
    return { error: "Too many sign-in attempts. Please wait a few minutes and try again." };
  }

  const genericError: ActionState = { error: "That email and password combination isn't right." };
  try {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, isDemo: true, memberships: { select: { organisationId: true }, take: 1, orderBy: { createdAt: "asc" } } },
    });
    if (!user || user.isDemo) {
      await burnPasswordCheck(password);
      return genericError;
    }
    if (!(await verifyPassword(password, user.passwordHash))) return genericError;

    await createSession(user.id, user.memberships[0]?.organisationId ?? null);
  } catch (error) {
    return toActionError(error);
  }
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

/** Signs out and returns to an invitation, so it can be accepted with a different account. */
export async function signOutToInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  await destroySession();
  redirect(/^[A-Za-z0-9_-]{20,128}$/.test(token) ? `/invite/${token}` : "/login");
}

/** Signs the visitor into the read-only demonstration workspace. */
export async function startDemoAction(_prev?: ActionState, _formData?: FormData): Promise<ActionState> {
  if (!env.demoEnabled) return { error: "The demo is not available right now." };
  const limit = rateLimit(`demo:${await ipKey()}`, 20, 60 * 60 * 1000);
  if (!limit.ok) return { error: "Too many demo sessions from your network. Try again later." };

  try {
    const demo = await db.user.findUnique({
      where: { email: DEMO_USER_EMAIL },
      select: { id: true, isDemo: true, memberships: { select: { organisationId: true }, take: 1 } },
    });
    if (!demo || !demo.isDemo || !demo.memberships[0]) {
      return { error: "The demo workspace hasn't been set up yet. Run `npm run db:seed`." };
    }
    await destroySession();
    await createSession(demo.id, demo.memberships[0].organisationId);
  } catch (error) {
    return toActionError(error);
  }
  redirect("/dashboard?demo=1");
}

/** Creates an additional workspace for the signed-in user (also used by onboarding). */
export async function createOrganisationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "You need to sign in to do that." };
  if (session.user.isDemo) return { error: "Demo visitors can't create workspaces. Create a free account instead." };

  const parsed = organisationSchema.safeParse(formToObject(formData));
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const org = await db.$transaction(async (tx) => {
      const created = await tx.organisation.create({
        data: { name: parsed.data.organisationName, slug: await uniqueSlug(tx, parsed.data.organisationName) },
      });
      await tx.membership.create({ data: { userId: session.userId, organisationId: created.id, role: "OWNER" } });
      await audit(
        { organisationId: created.id, userId: session.userId, action: "org.created", entityType: "organisation", entityId: created.id, summary: `${session.user.name} created the ${created.name} workspace` },
        tx,
      );
      return created;
    });
    await setSessionOrganisation(session.id, org.id);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return toActionError(error);
  }
  redirect("/dashboard");
}

export async function switchOrganisationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login");
  const parsed = idSchema.safeParse(formData.get("organisationId"));
  if (parsed.success) {
    // Only switch to organisations the user is actually a member of.
    const membership = await db.membership.findUnique({
      where: { userId_organisationId: { userId: session.userId, organisationId: parsed.data } },
      select: { organisationId: true },
    });
    if (membership) await setSessionOrganisation(session.id, membership.organisationId);
  }
  redirect("/dashboard");
}

/** Accepts an invitation for an already signed-in user. */
export async function acceptInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: "Sign in first to accept this invitation." };
  const invite = await findOpenInvitation(formData.get("token")?.toString());
  if (!invite) return { error: "This invitation link has expired or has already been used." };
  if (invite.email !== session.user.email.toLowerCase()) {
    return { error: `This invitation was sent to ${invite.email}. Sign in with that account to accept it.` };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: { userId_organisationId: { userId: session.userId, organisationId: invite.organisationId } },
        create: { userId: session.userId, organisationId: invite.organisationId, role: invite.role },
        update: {},
      });
      await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      await audit(
        { organisationId: invite.organisationId, userId: session.userId, action: "member.joined", entityType: "user", entityId: session.userId, summary: `${session.user.name} joined the workspace` },
        tx,
      );
    });
    await setSessionOrganisation(session.id, invite.organisationId);
  } catch (error) {
    return toActionError(error);
  }
  redirect("/dashboard");
}
