import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/crypto";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { invite: token } = await searchParams;

  let invite: { token: string; email: string; organisationName: string } | undefined;
  let inviteInvalid = false;
  if (token && token.length <= 128) {
    const record = await db.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organisation: { select: { name: true } } },
    });
    if (record && !record.acceptedAt && record.expiresAt > new Date()) {
      invite = { token, email: record.email, organisationName: record.organisation.name };
    } else {
      inviteInvalid = true;
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">
        {invite ? `Join ${invite.organisationName}` : "Create your workspace"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {invite
          ? "You've been invited to collaborate on SchoolVerse. Set up your account to accept."
          : "Free to start. Add your schools, invite your team and start mapping."}
      </p>
      {inviteInvalid ? (
        <p className="mt-5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          That invitation link has expired or was already used. Ask your admin for a new one, or create your own workspace below.
        </p>
      ) : null}
      <div className="mt-7">
        <RegisterForm invite={invite} />
      </div>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href={token && invite ? `/invite/${token}` : "/login"} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
