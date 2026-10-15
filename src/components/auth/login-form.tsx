"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/actions/auth";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next ?? "/dashboard"} />
      <FormError message={state.fieldErrors ? undefined : state.error} />
      <Field label="Email" name="email" type="email" autoComplete="email" required errors={state.fieldErrors?.email} />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      <div className="-mt-1 text-right">
        <Link href="/forgot-password" className="text-[13px] font-medium text-accent hover:underline">
          Forgot password?
        </Link>
      </div>
      <SubmitButton className="w-full" size="lg" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
