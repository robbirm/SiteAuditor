import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, DoorOpen, School } from "lucide-react";
import { requirePageAuth } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { getSchoolSummaries } from "@/lib/stats";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { AddSchoolButton } from "@/components/schools/school-dialogs";
import { cn, formatNumber, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Schools" };

export default async function SchoolsPage() {
  const ctx = await requirePageAuth();
  const schools = await getSchoolSummaries(ctx.organisation.id);
  const canCreate = can(ctx.role, "school:create");

  return (
    <>
      <PageHeader
        title="Schools"
        description="Every site in this workspace. Open one to manage its buildings, rooms and equipment."
        actions={canCreate ? <AddSchoolButton /> : null}
      />

      {schools.length === 0 ? (
        <Panel>
          <EmptyState icon={<School className="h-6 w-6" />} title="No schools yet" action={canCreate ? <AddSchoolButton label="Add your first school" /> : null}>
            Add a school to start mapping its buildings and equipment.
          </EmptyState>
        </Panel>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {schools.map((s) => (
            <li key={s.id}>
              <Link
                href={`/schools/${s.id}`}
                className="group block h-full rounded-2xl border border-line bg-surface p-5 shadow-card transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-semibold group-hover:text-accent">{s.name}</h2>
                    <p className="mt-0.5 truncate text-[13px] text-muted">
                      {[s.phase, s.postcode, s.pupilCount ? `${formatNumber(s.pupilCount)} pupils` : null].filter(Boolean).join(", ") ||
                        "No details yet"}
                    </p>
                  </div>
                </div>
                <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line/70 pt-4 text-sm">
                  <Stat icon={DoorOpen} label="Rooms" value={s._count.rooms} />
                  <Stat icon={Boxes} label="Assets" value={s._count.assets} />
                  <Stat icon={AlertTriangle} label="Warranty" value={s.warrantyAlerts} alert={s.warrantyAlerts > 0} />
                </dl>
                <p className="mt-4 flex items-center justify-between text-xs text-muted">
                  <span>Updated {relativeTime(s.updatedAt)}</span>
                  <span className="font-medium text-accent">Open</span>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  alert,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </dt>
      <dd className={cn("mt-1 font-display text-xl font-semibold tabular-nums", alert && "text-danger")}>{formatNumber(value)}</dd>
    </div>
  );
}
