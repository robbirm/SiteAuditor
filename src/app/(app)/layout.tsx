import { requirePageAuth } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app/app-shell";
import { can } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageAuth();
  const schools = await db.school.findMany({
    where: { organisationId: ctx.organisation.id },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 50,
  });

  return (
    <AppShell
      user={{ name: ctx.user.name, email: ctx.user.email, isDemo: ctx.user.isDemo }}
      organisation={{ id: ctx.organisation.id, name: ctx.organisation.name, isDemo: ctx.organisation.isDemo }}
      role={ctx.role}
      memberships={ctx.memberships}
      schools={schools}
      canCreateSchool={can(ctx.role, "school:create")}
    >
      {children}
    </AppShell>
  );
}
