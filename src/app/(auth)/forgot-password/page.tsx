import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/password-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-sm text-muted">Enter the email you sign in with and we&apos;ll send you a link to choose a new password. The link works once and expires after 30 minutes.</p>
      <div className="mt-7">
        <ForgotPasswordForm />
      </div>
      <p className="mt-6 text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
