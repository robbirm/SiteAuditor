"use client";

import { useEffect } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Server errors arrive with a digest and a generic message (details stay in the
  // server log). Browser errors have no digest; their message is safe to show and
  // is the quickest way to diagnose a problem.
  const reference = error.digest ? `Server error ${error.digest}` : `Browser error: ${error.message || "unknown"}`;

  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <h1 className="font-display text-2xl font-semibold">This page didn&apos;t load</h1>
      <p className="mt-2 text-sm text-muted">Something went wrong while showing this page. Try again; if it keeps happening, send support the details below.</p>
      <pre className="mt-5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface p-3 text-left font-mono text-xs text-muted">
        {reference}
      </pre>
      <Button className="mt-6" onClick={reset}>
        <RotateCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
