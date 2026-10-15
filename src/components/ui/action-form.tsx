"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { FormError } from "./field";
import { useActionFeedback } from "./use-action-feedback";
import { safeAction } from "./safe-action";

type ServerAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Binds a server action to a form, handles toasts and resets the form after
 * success. `children` can be a render function to read field errors.
 */
export function ActionForm({
  action,
  hidden,
  onSuccess,
  className,
  children,
}: {
  action: ServerAction;
  hidden?: Record<string, string>;
  onSuccess?: () => void;
  className?: string;
  children: React.ReactNode | ((state: ActionState) => React.ReactNode);
}) {
  const [state, formAction] = useActionState(useMemo(() => safeAction(action), [action]), {});
  const formRef = useRef<HTMLFormElement>(null);
  useActionFeedback(state, () => {
    formRef.current?.reset();
    onSuccess?.();
  });
  return (
    <form ref={formRef} action={formAction} className={className} noValidate>
      {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      {state.fieldErrors ? <FormError message={state.error} /> : null}
      {typeof children === "function" ? children(state) : children}
    </form>
  );
}

/** Two-step inline delete: first click arms, second click submits. */
export function DeleteButton({
  action,
  hidden,
  label,
  className,
}: {
  action: ServerAction;
  hidden: Record<string, string>;
  label: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [state, formAction, pending] = useActionState(useMemo(() => safeAction(action), [action]), {});
  useActionFeedback(state);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <form action={formAction}>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        // Unarmed it's a plain button that arms; armed it submits.
        type={armed ? "submit" : "button"}
        onClick={armed ? undefined : () => setArmed(true)}
        disabled={pending}
        aria-label={armed ? `Confirm: ${label}` : label}
        title={label}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors disabled:opacity-50",
          armed ? "bg-danger/15 px-2 text-danger" : "text-muted hover:bg-danger/10 hover:text-danger",
          className,
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {armed ? "Confirm" : null}
      </button>
    </form>
  );
}
