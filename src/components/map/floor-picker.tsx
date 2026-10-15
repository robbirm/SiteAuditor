"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Building2 } from "lucide-react";
import { createBuildingAction } from "@/actions/structure";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

export function FloorPicker({
  schoolId,
  currentFloorId,
  floors,
}: {
  schoolId: string;
  currentFloorId: string;
  floors: { id: string; label: string; roomCount: number }[];
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2">
      <span className="text-sm text-muted">Showing</span>
      <select
        className="field-input h-9 w-auto min-w-[220px] pr-8"
        value={currentFloorId}
        onChange={(e) => router.push(`/schools/${schoolId}/map?floor=${e.target.value}`)}
      >
        {floors.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label} ({f.roomCount} {f.roomCount === 1 ? "room" : "rooms"})
          </option>
        ))}
      </select>
    </label>
  );
}

/** Shown when a school has no buildings yet: create the first one in place. */
export function FirstBuildingForm({ schoolId }: { schoolId: string }) {
  const [state, action] = useActionState(createBuildingAction, {});
  return (
    <form action={action} className="mx-auto max-w-sm space-y-4 text-left" noValidate>
      <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface-2 text-accent">
        <Building2 className="h-6 w-6" />
      </div>
      <h2 className="text-center font-display text-lg font-semibold">Start with a building</h2>
      <p className="text-center text-sm text-muted">Give it a name and you&apos;ll get a ground floor to start placing rooms on.</p>
      <input type="hidden" name="schoolId" value={schoolId} />
      <FormError message={state.fieldErrors ? undefined : state.ok ? undefined : state.error} />
      <Field label="Building name" name="name" placeholder="e.g. Main block" errors={state.fieldErrors?.name} />
      <SubmitButton className="w-full" pendingLabel="Creating…">
        Create building
      </SubmitButton>
    </form>
  );
}
