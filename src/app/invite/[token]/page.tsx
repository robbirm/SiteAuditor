import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { buttonClasses } from "@/components/ui/button-classes";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/crypto";
import { getSession } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { signOutToInvitationAction } from "@/actions/auth";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite =
    token.length <= 128
      ? await db.invitation.findUnique({
          where: { tokenHash: hashToken(token) },
          include: { organisation: { select: { name: true } }, invitedBy: { select: { name: true } } },
        })
      : null;
  const valid = invite && !invite.acceptedAt && invite.expiresAt > new Date();
  const session = await getSession();

  return (
    <div className="blueprint flex min-h-dvh flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 shadow-card">
        <Logo className="mb-8" />
        {!valid ? (
          <>
            <h1 className="font-display text-2xl font-semibold">This invitation can&apos;t be used</h1>
            <p className="mt-2 text-sm text-muted">It may have expired, been revoked, or already been accepted. Ask the person who invited you for a new link.</p>
            <Link href="/" className={buttonClasses("secondary", "md", "mt-6")}>
              Back to SchoolVerse
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-semibold">Join {invite.organisation.name}</h1>
            <p className="mt-2 text-sm text-muted">
              {invite.invitedBy?.name ?? "An administrator"} invited <strong className="text-fg">{invite.email}</strong> to join as{" "}
              <strong className="text-fg">{ROLE_LABELS[invite.role]}</strong>.
            </p>
            <div className="mt-7">
              {session ? (
                session.user.email.toLowerCase() === invite.email.toLowerCase() ? (
                  <AcceptInviteForm token={token} organisationName={invite.organisation.name} />
                ) : (
                  <div className="space-y-3">
                    <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                      You&apos;re signed in as {session.user.email}, but this invitation is for {invite.email}.
                    </p>
                    <form action={signOutToInvitationAction}>
                      <input type="hidden" name="token" value={token} />
                      <button type="submit" className={buttonClasses("primary", "lg", "w-full")}>
                        Sign out and continue as {invite.email}
                      </button>
                    </form>
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-2.5">
                  <Link href={`/register?invite=${encodeURIComponent(token)}`} className={buttonClasses("primary", "lg")}>
                    Create an account to join
                  </Link>
                  <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className={buttonClasses("secondary", "lg")}>
                    I already have an account
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
