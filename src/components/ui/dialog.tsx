"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/** A centred modal on desktop that becomes a bottom sheet on small screens. */
export function DialogContent({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[#02060c]/70 backdrop-blur-[2px] data-[state=open]:animate-[sv-fade-in_0.18s_ease-out]" />
      <RadixDialog.Content
        className={cn(
          "fixed z-50 max-h-[92dvh] w-full overflow-y-auto border border-line bg-surface shadow-2xl focus:outline-none",
          "inset-x-0 bottom-0 rounded-t-2xl p-5 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-6",
          "data-[state=open]:animate-[sv-pop_0.2s_ease-out]",
          className,
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <RadixDialog.Title className="font-display text-lg font-semibold">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-sm text-muted">{description}</RadixDialog.Description>
            ) : (
              <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X className="h-4 w-4" />
          </RadixDialog.Close>
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
