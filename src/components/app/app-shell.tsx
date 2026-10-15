"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Role } from "@prisma/client";
import { Box, Boxes, Home, Menu, School, UserRound, Users, X } from "lucide-react";
import { Logo } from "@/components/brand";
import { cn } from "@/lib/utils";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { UserMenu } from "./user-menu";

type Props = {
  user: { name: string; email: string; isDemo: boolean };
  organisation: { id: string; name: string; isDemo: boolean };
  role: Role;
  memberships: { organisationId: string; name: string; role: Role; isDemo: boolean }[];
  schools: { id: string; name: string }[];
  canCreateSchool: boolean;
  children: React.ReactNode;
};

export function AppShell({ user, organisation, role, memberships, schools, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMobileOpen(false), [pathname]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-5">
        <Logo href="/dashboard" />
        <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <WorkspaceSwitcher current={organisation} memberships={memberships} canCreate={!user.isDemo} />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
        <NavLink href="/dashboard" icon={Home} active={pathname === "/dashboard"}>
          Home
        </NavLink>
        <NavLink href="/schools" icon={School} active={pathname === "/schools"}>
          Schools
        </NavLink>
        {schools.length > 0 ? (
          <ul className="mb-2 ml-[19px] mt-1 space-y-0.5 border-l border-line pl-3">
            {schools.map((s) => {
              const active = pathname.startsWith(`/schools/${s.id}`);
              const onPlan = pathname.startsWith(`/schools/${s.id}/map`);
              return (
                <li key={s.id}>
                  <Link
                    href={`/schools/${s.id}`}
                    className={cn(
                      "block truncate rounded-md px-2 py-1.5 text-[13px] transition-colors",
                      active && !onPlan ? "bg-accent/10 font-medium text-accent" : active ? "font-medium text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                    )}
                  >
                    {s.name}
                  </Link>
                  {active ? (
                    <Link
                      href={`/schools/${s.id}/map`}
                      className={cn(
                        "ml-2 mt-0.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
                        onPlan ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <Box className="h-3.5 w-3.5" />
                      Floor plan
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <NavLink href="/assets" icon={Boxes} active={pathname.startsWith("/assets")}>
          Assets
        </NavLink>
        <NavLink href="/settings/team" icon={Users} active={pathname.startsWith("/settings/team")}>
          Team
        </NavLink>
        <NavLink href="/settings/account" icon={UserRound} active={pathname.startsWith("/settings/account")}>
          Account
        </NavLink>
      </nav>

      <div className="border-t border-line p-3">
        <UserMenu user={user} role={role} />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh border-r border-line bg-surface/60 lg:block">{sidebar}</aside>

      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-[#02060c]/70 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-line bg-surface lg:hidden"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
            >
              {sidebar}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <div className="min-w-0">
        {organisation.isDemo ? (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-accent/25 bg-accent/10 px-4 py-2 text-center text-[13px]">
            <span>You&apos;re exploring a fictional demo school. Everything here is read-only.</span>
            <Link href="/register" className="font-semibold text-accent hover:underline">
              Create your own workspace
            </Link>
          </div>
        ) : null}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur lg:hidden">
          <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate font-display font-semibold">{organisation.name}</span>
        </div>
        <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  icon: Icon,
  active,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
        active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2/70 hover:text-fg",
      )}
    >
      {active ? <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r bg-accent" aria-hidden /> : null}
      <Icon className={cn("h-[18px] w-[18px]", active ? "text-accent" : "")} />
      {children}
    </Link>
  );
}
