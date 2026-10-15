import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { can, type Permission } from "./rbac";
import { getSession } from "./session";

export class AuthError extends Error {
  constructor(message = "You need to sign in to do that.") {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "That record could not be found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export type AuthContext = {
  sessionId: string;
  user: { id: string; email: string; name: string; isDemo: boolean };
  organisation: { id: string; name: string; slug: string; isDemo: boolean };
  role: Role;
  memberships: { organisationId: string; name: string; role: Role; isDemo: boolean }[];
};

/**
 * Resolves the signed-in user and their *active* organisation. The active
 * organisation is stored on the server-side session and is always re-checked
 * against a live Membership row, so revoking access takes effect immediately.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await getSession();
  if (!session) return null;

  const memberships = await db.membership.findMany({
    where: { userId: session.userId },
    include: { organisation: { select: { id: true, name: true, slug: true, isDemo: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) {
    return null;
  }

  const active =
    memberships.find((m) => m.organisationId === session.organisationId) ?? memberships[0]!;

  if (active.organisationId !== session.organisationId) {
    await db.session
      .update({ where: { id: session.id }, data: { organisationId: active.organisationId } })
      .catch(() => undefined);
  }

  return {
    sessionId: session.id,
    user: session.user,
    organisation: active.organisation,
    role: active.role,
    memberships: memberships.map((m) => ({
      organisationId: m.organisationId,
      name: m.organisation.name,
      role: m.role,
      isDemo: m.organisation.isDemo,
    })),
  };
});

/** For pages: redirect to login (or onboarding) instead of throwing. */
export async function requirePageAuth(): Promise<AuthContext> {
  const session = await getSession();
  // A cookie is present (middleware let us through) but it's expired or
  // revoked: clear it via a route handler, otherwise /login would bounce back.
  if (!session) redirect("/auth/reset");
  const ctx = await getAuthContext();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

export async function requirePagePermission(permission: Permission): Promise<AuthContext> {
  const ctx = await requirePageAuth();
  if (!can(ctx.role, permission)) redirect("/dashboard?denied=1");
  return ctx;
}

/** For server actions & route handlers: throw typed errors. */
export async function authorize(permission: Permission): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw new AuthError();
  if (!can(ctx.role, permission)) throw new ForbiddenError();
  return ctx;
}
