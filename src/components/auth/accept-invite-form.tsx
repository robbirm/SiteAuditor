"use client";

import { useActionState } from "react";
import { acceptInvitationAction } from "@/actions/auth";
import { SubmitButton } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

export function AcceptInviteForm({ token, organisationName }: { token: string; organisationName: string }) {
  const [state, action] = useActionState(acceptInvitationAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormError message={state.error} />
      <SubmitButton size="lg" className="w-full" pendingLabel="Joining…">
        Join {organisationName}
      </SubmitButton>
    </form>
  );
}
