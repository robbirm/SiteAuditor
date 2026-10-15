"use client";

import { useActionState } from "react";
import { createSchoolAction, updateSchoolAction } from "@/actions/schools";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError, Select, Textarea } from "@/components/ui/field";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import { SCHOOL_PHASES } from "@/lib/labels";

export type SchoolFormValues = {
  id: string;
  name: string;
  code: string | null;
  phase: string | null;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  pupilCount: number | null;
  staffCount: number | null;
  notes: string | null;
};

export function SchoolForm({ school, onDone }: { school?: SchoolFormValues; onDone?: () => void }) {
  const [state, action] = useActionState(school ? updateSchoolAction : createSchoolAction, {});
  useActionFeedback(state, onDone);
  const fe = state.fieldErrors;

  return (
    <form action={action} className="space-y-4" noValidate>
      {school ? <input type="hidden" name="schoolId" value={school.id} /> : null}
      <FormError message={state.error && !state.ok ? state.error : undefined} />
      <Field label="School name" name="name" required defaultValue={school?.name} errors={fe?.name} placeholder="e.g. Harbour Lane Primary" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phase" name="phase" errors={fe?.phase}>
          <Select id="f-phase" name="phase" defaultValue={school?.phase ?? ""}>
            <option value="">Not set</option>
            {SCHOOL_PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="School code (URN/DfE)" name="code" defaultValue={school?.code ?? ""} errors={fe?.code} />
      </div>
      <Field label="Address" name="address" defaultValue={school?.address ?? ""} errors={fe?.address} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Postcode" name="postcode" defaultValue={school?.postcode ?? ""} errors={fe?.postcode} />
        <Field label="Phone" name="phone" type="tel" defaultValue={school?.phone ?? ""} errors={fe?.phone} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="IT contact" name="contactName" defaultValue={school?.contactName ?? ""} errors={fe?.contactName} />
        <Field label="Contact email" name="contactEmail" type="email" defaultValue={school?.contactEmail ?? ""} errors={fe?.contactEmail} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Pupils"
          name="pupilCount"
          type="number"
          min={0}
          inputMode="numeric"
          defaultValue={school?.pupilCount ?? ""}
          errors={fe?.pupilCount}
          hint="Helps you size the network for each site."
        />
        <Field label="Staff" name="staffCount" type="number" min={0} inputMode="numeric" defaultValue={school?.staffCount ?? ""} errors={fe?.staffCount} />
      </div>
      <Field label="Notes" name="notes" errors={fe?.notes}>
        <Textarea id="f-notes" name="notes" defaultValue={school?.notes ?? ""} rows={3} />
      </Field>
      <div className="flex justify-end pt-1">
        <SubmitButton pendingLabel={school ? "Saving…" : "Adding…"}>{school ? "Save changes" : "Add school"}</SubmitButton>
      </div>
    </form>
  );
}
