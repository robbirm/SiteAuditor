"use client";

import { useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { Role } from "@prisma/client";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { switchOrganisationAction } from "@/actions/auth";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { initials } from "@/lib/utils";
import { CreateOrganisationForm } from "./create-organisation-form";

type Props = {
  current: { id: string; name: string; isDemo: boolean };
  memberships: { organisationId: string; name: string; role: Role; isDemo: boolean }[];
  canCreate: boolean;
};

export function WorkspaceSwitcher({ current, memberships, canCreate }: Props) {
  const [creating, setCreating] = useState(false);
  const currentRole = memberships.find((m) => m.organisationId === current.id)?.role;

  return (
    <>
      <Menu.Root>
        <Menu.Trigger className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-2.5 py-2 text-left transition-colors hover:border-muted/40 data-[state=open]:border-accent/50">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-navy font-display text-xs font-semibold text-accent ring-1 ring-accent/25">
            {initials(current.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{current.name}</span>
            <span className="block text-xs text-muted">{currentRole ? ROLE_LABELS[currentRole] : ""}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-muted" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="start"
            sideOffset={6}
            className="z-50 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[240px] rounded-xl border border-line bg-surface-2 p-1.5 shadow-2xl data-[state=open]:animate-[sv-fade-in_0.12s_ease-out]"
          >
            <Menu.Label className="px-2 pb-1 pt-1.5 text-xs text-muted">Workspaces</Menu.Label>
            {memberships.map((m) => (
              <form key={m.organisationId} action={switchOrganisationAction}>
                <input type="hidden" name="organisationId" value={m.organisationId} />
                <Menu.Item asChild>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm outline-none data-[highlighted]:bg-surface"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-navy text-[10px] font-semibold text-accent">
                      {initials(m.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    {m.organisationId === current.id ? <Check className="h-4 w-4 text-accent" /> : null}
                  </button>
                </Menu.Item>
              </form>
            ))}
            {canCreate ? (
              <>
                <Menu.Separator className="my-1.5 h-px bg-line" />
                <Menu.Item
                  onSelect={() => setCreating(true)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-muted outline-none data-[highlighted]:bg-surface data-[highlighted]:text-fg"
                >
                  <Plus className="h-4 w-4" />
                  New workspace
                </Menu.Item>
              </>
            ) : null}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New workspace" description="Workspaces keep schools, teams and data completely separate — for example, one per customer.">
          <CreateOrganisationForm />
        </DialogContent>
      </Dialog>
    </>
  );
}
