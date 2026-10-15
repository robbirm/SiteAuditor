import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/password-forms";
import { findValidResetToken } from "@/lib/auth/password-reset";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = await findValidResetToken(token);

  if (!record) {
    return (
      <div>
        <h1 className="font-display text-3xl font-semibold">This link has expired</h1>
        <p className="mt-2 text-sm text-muted">Reset links work once and only for a limited time. Request a new one to carry on.</p>
        <Link href="/forgot-password" className="mt-6 inline-block font-medium text-accent hover:underline">
          Request a new reset link
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Choose a new password</h1>
      <p className="mt-2 text-sm text-muted">
        For <strong className="text-fg">{record.user.email}</strong>. You&apos;ll be signed in once it&apos;s saved.
      </p>
      <div className="mt-7">
        <ResetPasswordForm token={token} />
      </div>
    </div>
  );
}
