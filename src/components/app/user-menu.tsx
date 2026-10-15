"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import type { Role } from "@prisma/client";
import { LogOut, Moon, Sun } from "lucide-react";
import { logoutAction } from "@/actions/auth";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { initials } from "@/lib/utils";

export function UserMenu({ user, role }: { user: { name: string; email: string; isDemo: boolean }; role: Role }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = !mounted || resolvedTheme !== "light";

  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold ring-1 ring-line">
        {initials(user.name)}
      </span>
      <Link href="/settings/account" className="min-w-0 flex-1 rounded-md hover:text-accent" title="Account settings">
        <p className="truncate text-sm font-medium">{user.isDemo ? "Demo visitor" : user.name}</p>
        <p className="truncate text-xs text-muted">{user.isDemo ? "Read-only access" : ROLE_LABELS[role]}</p>
      </Link>
      <button
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        className="rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        title={isDark ? "Light mode" : "Dark mode"}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-lg p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
