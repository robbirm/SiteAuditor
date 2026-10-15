"use client";

import { useActionState } from "react";
import { createOrganisationAction } from "@/actions/auth";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

export function CreateOrganisationForm() {
  const [state, action] = useActionState(createOrganisationAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormError message={state.fieldErrors ? undefined : state.error} />
      <Field
        label="Organisation name"
        name="organisationName"
        placeholder="e.g. Riverside Academy Trust"
        required
        errors={state.fieldErrors?.organisationName}
      />
      <SubmitButton className="w-full" pendingLabel="Creating…">
        Create workspace
      </SubmitButton>
    </form>
  );
}
