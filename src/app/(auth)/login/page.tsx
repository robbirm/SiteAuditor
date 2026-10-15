import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { DemoButton } from "@/components/marketing/demo-button";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { next, expired } = await searchParams;
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">Welcome back</h1>
      <p className="mt-2 text-sm text-muted">Sign in to your SchoolVerse workspace.</p>
      {expired ? (
        <p className="mt-5 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          Your session ended. Sign in again to carry on.
        </p>
      ) : null}
      <div className="mt-7">
        <LoginForm next={next} />
      </div>
      <p className="mt-6 text-sm text-muted">
        New to SchoolVerse?{" "}
        <Link href="/register" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
      {env.demoEnabled ? (
        <div className="mt-8 border-t border-line pt-6">
          <p className="mb-3 text-sm text-muted">Just looking? Explore a fictional school without signing up.</p>
          <DemoButton variant="secondary" className="w-full" />
        </div>
      ) : null}
    </div>
  );
}
