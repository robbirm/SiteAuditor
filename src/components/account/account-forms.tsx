"use client";

import { useActionState, useRef, useState } from "react";
import { changePasswordAction, signOutOtherSessionsAction, updateProfileAction } from "@/actions/account";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { useActionFeedback } from "@/components/ui/use-action-feedback";

export function ProfileForm({ name, email, disabled }: { name: string; email: string; disabled: boolean }) {
  const [state, action] = useActionState(updateProfileAction, {});
  const [emailValue, setEmailValue] = useState(email);
  useActionFeedback(state);
  const emailChanged = emailValue.trim().toLowerCase() !== email;

  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state.fieldErrors ? undefined : state.ok ? undefined : state.error} />
      <Field label="Name" name="name" autoComplete="name" defaultValue={name} disabled={disabled} errors={state.fieldErrors?.name} />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        value={emailValue}
        onChange={(e) => setEmailValue(e.target.value)}
        disabled={disabled}
        hint="This is the email you sign in with."
        errors={state.fieldErrors?.email}
      />
      {emailChanged ? (
        <Field
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          hint="Needed to change your sign-in email."
          errors={state.fieldErrors?.currentPassword}
        />
      ) : null}
      <div className="flex justify-end">
        <SubmitButton disabled={disabled} pendingLabel="Saving…">
          Save profile
        </SubmitButton>
      </div>
    </form>
  );
}

export function ChangePasswordForm({ disabled }: { disabled: boolean }) {
  const [state, action] = useActionState(changePasswordAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  useActionFeedback(state, () => formRef.current?.reset());

  return (
    <form ref={formRef} action={action} className="space-y-4" noValidate>
      <FormError message={state.fieldErrors ? undefined : state.ok ? undefined : state.error} />
      <Field
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        disabled={disabled}
        errors={state.fieldErrors?.currentPassword}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          disabled={disabled}
          hint="10+ characters, a letter and a number."
          errors={state.fieldErrors?.newPassword}
        />
        <Field
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          disabled={disabled}
          errors={state.fieldErrors?.confirmPassword}
        />
      </div>
      <div className="flex justify-end">
        <SubmitButton disabled={disabled} pendingLabel="Changing…">
          Change password
        </SubmitButton>
      </div>
    </form>
  );
}

export function SignOutOthersButton({ disabled }: { disabled: boolean }) {
  const [state, action] = useActionState(signOutOtherSessionsAction, {});
  useActionFeedback(state);
  return (
    <form action={action}>
      <SubmitButton variant="secondary" size="sm" disabled={disabled} pendingLabel="Signing out…">
        Sign out other devices
      </SubmitButton>
    </form>
  );
}
