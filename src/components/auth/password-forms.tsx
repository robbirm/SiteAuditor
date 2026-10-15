"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, resetPasswordAction } from "@/actions/account";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, {});
  if (state.ok) {
    return (
      <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-3 text-sm text-success">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state.fieldErrors ? undefined : state.error} />
      <Field label="Email" name="email" type="email" autoComplete="email" required errors={state.fieldErrors?.email} />
      <SubmitButton className="w-full" size="lg" pendingLabel="Sending…">
        Email me a reset link
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <FormError message={state.fieldErrors ? undefined : state.error} />
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters, with a letter and a number."
        errors={state.fieldErrors?.password}
      />
      <Field
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton className="w-full" size="lg" pendingLabel="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
