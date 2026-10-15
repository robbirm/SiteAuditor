"use client";

import type { ActionState } from "@/lib/action-result";

const OFFLINE: ActionState = {
  error: "Couldn't reach the server, so that wasn't saved. Check your connection and try again (or reload the page if the site was just updated).",
};

function isNavigationSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"));
}

/**
 * Wraps a server action so a failed request (network drop, server restart,
 * a deploy that changed action ids) becomes an error message instead of
 * crashing the whole page through the error boundary.
 */
export function safeAction<A extends unknown[]>(action: (...args: A) => Promise<ActionState>) {
  return async (...args: A): Promise<ActionState> => {
    try {
      return await action(...args);
    } catch (error) {
      if (isNavigationSignal(error)) throw error;
      console.error("[action] request failed", error);
      return OFFLINE;
    }
  };
}
