"use client";

import { useActionState } from "react";
import { registerAction } from "@/actions/auth";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

export function RegisterForm({ invite }: { invite?: { token: string; email: string; organisationName: string } }) {
  const [state, action] = useActionState(registerAction, {});
  const fe = state.fieldErrors;
  return (
    <form action={action} className="space-y-4" noValidate>
      {invite ? <input type="hidden" name="invite" value={invite.token} /> : null}
      <FormError message={fe ? undefined : state.error} />
      <Field label="Your name" name="name" autoComplete="name" required errors={fe?.name} />
      <Field
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={invite?.email}
        readOnly={Boolean(invite)}
        errors={fe?.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 10 characters, with a letter and a number."
        errors={fe?.password}
      />
      {invite ? null : (
        <Field
          label="Organisation"
          name="organisationName"
          placeholder="e.g. Riverside Academy Trust or your IT company"
          required
          hint="This becomes your workspace. You can add schools to it next."
          errors={fe?.organisationName}
        />
      )}
      <SubmitButton className="w-full" size="lg" pendingLabel="Creating account…">
        {invite ? `Join ${invite.organisationName}` : "Create account"}
      </SubmitButton>
    </form>
  );
}
