"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteSchoolAction } from "@/actions/schools";
import { Button, SubmitButton, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import { SchoolForm, type SchoolFormValues } from "./school-form";

export function AddSchoolButton({ label = "Add school", ...props }: ButtonProps & { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button {...props}>
          <Plus className="h-4 w-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a school" description="You can add buildings, rooms and equipment once it's created.">
        <SchoolForm />
      </DialogContent>
    </Dialog>
  );
}

export function EditSchoolButton({ school }: { school: SchoolFormValues }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Pencil className="h-3.5 w-3.5" />
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent title={`Edit ${school.name}`}>
        <SchoolForm school={school} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSchoolButton({ schoolId, schoolName }: { schoolId: string; schoolName: string }) {
  const [state, action] = useActionState(deleteSchoolAction, {});
  useActionFeedback(state);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm">
          <Trash2 className="h-3.5 w-3.5" />
          Delete school
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Delete this school?"
        description="This permanently removes the school with all of its buildings, rooms, equipment, faults and network maps. It can't be undone."
      >
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="schoolId" value={schoolId} />
          <FormError message={state.fieldErrors ? undefined : state.error} />
          <Field
            label={`Type "${schoolName}" to confirm`}
            name="confirmName"
            autoComplete="off"
            errors={state.fieldErrors?.confirmName}
          />
          <div className="flex justify-end">
            <SubmitButton variant="danger" pendingLabel="Deleting…">
              Delete school
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
