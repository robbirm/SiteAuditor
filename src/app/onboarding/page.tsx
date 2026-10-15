import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { CreateOrganisationForm } from "@/components/app/create-organisation-form";
import { getSession } from "@/lib/auth/session";
import { getAuthContext } from "@/lib/auth/context";
import { logoutAction } from "@/actions/auth";

export const metadata: Metadata = { title: "Set up your workspace" };

/** Shown to signed-in users who no longer belong to any organisation. */
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/auth/reset");
  if (await getAuthContext()) redirect("/dashboard");

  return (
    <div className="blueprint flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 shadow-card">
        <Logo className="mb-8" />
        <h1 className="font-display text-2xl font-semibold">Set up a workspace</h1>
        <p className="mt-2 text-sm text-muted">
          You&apos;re not a member of any organisation right now. Create one to start adding schools, or ask an admin to invite you.
        </p>
        <div className="mt-6">
          <CreateOrganisationForm />
        </div>
        <form action={logoutAction} className="mt-6 border-t border-line pt-4">
          <button className="text-sm text-muted hover:text-fg">Sign out of {session.user.email}</button>
        </form>
      </div>
    </div>
  );
}
