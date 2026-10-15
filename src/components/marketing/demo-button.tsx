"use client";

import { useActionState } from "react";
import { startDemoAction } from "@/actions/auth";
import { SubmitButton, type ButtonProps } from "@/components/ui/button";
import { useActionFeedback } from "@/components/ui/use-action-feedback";

export function DemoButton({ label = "Explore the demo school", ...props }: ButtonProps & { label?: string }) {
  const [state, action] = useActionState(startDemoAction, {});
  useActionFeedback(state);
  return (
    <form action={action}>
      <SubmitButton pendingLabel="Opening demo…" {...props}>
        {label}
      </SubmitButton>
    </form>
  );
}
