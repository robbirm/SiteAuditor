"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ActionState } from "@/lib/action-result";

/**
 * Turns server-action results into toasts. `onSuccess` runs once per
 * successful submission (e.g. to close a dialog or reset a form).
 */
export function useActionFeedback(state: ActionState, onSuccess?: () => void) {
  const last = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      onSuccess?.();
    } else if (state.error && !state.fieldErrors) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}
