"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Role } from "@prisma/client";
import { Check, Copy, KeyRound, Send } from "lucide-react";
import { toast } from "sonner";
import { changeMemberRoleAction, inviteMemberAction, removeMemberAction, resendInvitationAction, revokeInvitationAction } from "@/actions/team";
import { createMemberResetLinkAction } from "@/actions/account";
import { DeleteButton } from "@/components/ui/action-form";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError, Select } from "@/components/ui/field";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import { ROLE_LABELS } from "@/lib/auth/rbac";

export function InviteForm({ roles }: { roles: readonly Role[] }) {
  const [state, action] = useActionState(inviteMemberAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  useActionFeedback(state, () => formRef.current?.reset());

  const link = state.ok ? state.data?.link : undefined;

  return (
    <div className="space-y-4">
      <form ref={formRef} action={action} className="space-y-4" noValidate>
        <FormError message={state.fieldErrors ? undefined : state.ok ? undefined : state.error} />
        <Field label="Email" name="email" type="email" required placeholder="name@school.org.uk" errors={state.fieldErrors?.email} />
        <Field label="Role" name="role" errors={state.fieldErrors?.role}>
          <Select id="f-role" name="role" defaultValue={roles.includes("TECHNICIAN") ? "TECHNICIAN" : roles[0]}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <SubmitButton className="w-full" pendingLabel="Creating link…">
          Create invitation link
        </SubmitButton>
      </form>

      {link ? (
        <CopyLink
          link={link}
          note={state.data?.emailed === "yes" ? "Emailed. You can also copy the link if it doesn't arrive." : "Send this link to them. It works once and won't be shown again."}
        />
      ) : null}
    </div>
  );
}

export function MemberRoleSelect({ membershipId, role, roles }: { membershipId: string; role: Role; roles: readonly Role[] }) {
  const [state, action, pending] = useActionState(changeMemberRoleAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  useActionFeedback(state);
  // If the change was refused, put the select back to the saved role.
  useEffect(() => {
    if (state.error) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="membershipId" value={membershipId} />
      <Select
        name="role"
        defaultValue={role}
        disabled={pending}
        aria-label="Role"
        className="h-8 w-[130px] text-xs"
        onChange={() => formRef.current?.requestSubmit()}
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
    </form>
  );
}

export function RemoveMemberButton({ membershipId, name }: { membershipId: string; name: string }) {
  return <DeleteButton action={removeMemberAction} hidden={{ membershipId }} label={`Remove ${name}`} />;
}

export function RevokeInviteButton({ invitationId }: { invitationId: string }) {
  return <DeleteButton action={revokeInvitationAction} hidden={{ invitationId }} label="Revoke invitation" />;
}

function CopyLink({ link, note }: { link: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/10 p-3">
      <p className="mb-2 text-xs text-muted">{note}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-bg/70 px-2 py-1.5 font-mono text-xs">{link}</code>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-fg"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Couldn't copy automatically. Select the link and copy it.");
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Lets an admin give a member a one-time password reset link. */
export function ResetPasswordLinkButton({ membershipId, name }: { membershipId: string; name: string }) {
  const [state, action] = useActionState(createMemberResetLinkAction, {});
  useActionFeedback(state);
  const link = state.ok ? state.data?.link : undefined;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center rounded-md px-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          aria-label={`Create a password reset link for ${name}`}
          title="Password reset link"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent
        title={`Reset ${name}'s password`}
        description="Creates a one-time link they can open to choose a new password. It expires in 24 hours and signs them out everywhere once used."
      >
        {link ? (
          <CopyLink link={link} note="Send this link to them privately. It won't be shown again." />
        ) : (
          <form action={action} className="flex justify-end">
            <input type="hidden" name="membershipId" value={membershipId} />
            <SubmitButton pendingLabel="Creating…">Create reset link</SubmitButton>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ResendInviteButton({ invitationId }: { invitationId: string }) {
  const [state, action, pending] = useActionState(resendInvitationAction, {});
  useActionFeedback(state);
  const link = state.ok && state.data?.emailed !== "yes" ? state.data?.link : undefined;
  return (
    <div className="flex flex-col items-end gap-2">
      <form action={action}>
        <input type="hidden" name="invitationId" value={invitationId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-50"
          title="Send a fresh link"
        >
          <Send className="h-3.5 w-3.5" />
          Resend
        </button>
      </form>
      {link ? <CopyLink link={link} note="New link (the old one no longer works):" /> : null}
    </div>
  );
}
