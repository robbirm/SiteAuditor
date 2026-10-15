import type { Metadata } from "next";
import { Suspense } from "react";
import { School } from "lucide-react";
import { requirePageAuth } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { getDashboardStats, getSchoolSummaries } from "@/lib/stats";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { AddSchoolButton } from "@/components/schools/school-dialogs";
import { ActivityFeed, AssetMix, Readout, SchoolsTable, WarrantyList } from "@/components/dashboard/widgets";
import Link from "next/link";
import { Box, Boxes, Upload, UserPlus } from "lucide-react";
import { AddAssetButton } from "@/components/assets/asset-form";
import { getAssetFormOptions } from "@/lib/asset-options";
import { DashboardNotices } from "@/components/dashboard/notices";
import { formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requirePageAuth();
  const [stats, schools, assetOptions] = await Promise.all([
    getDashboardStats(ctx.organisation.id),
    getSchoolSummaries(ctx.organisation.id),
    getAssetFormOptions(ctx.organisation.id),
  ]);
  const canCreate = can(ctx.role, "school:create");
  const canAssets = can(ctx.role, "asset:write");
  const canTeam = can(ctx.role, "member:manage");
  const planHref = schools.length === 1 ? `/schools/${schools[0]!.id}/map` : "/schools";

  const tile =
    "group flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-4 text-left shadow-card transition-colors hover:border-accent/50";
  const tileIcon = "grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent";

  return (
    <>
      <Suspense fallback={null}>
        <DashboardNotices />
      </Suspense>
      <PageHeader
        title={ctx.organisation.name}
        description={
          schools.length === 0
            ? "Start by adding the first school you look after."
            : `${formatNumber(stats.schoolCount)} ${stats.schoolCount === 1 ? "school" : "schools"}, ${formatNumber(stats.roomCount)} rooms and ${formatNumber(stats.assetCount)} devices on record.`
        }
        actions={canCreate ? <AddSchoolButton variant={schools.length ? "secondary" : "primary"} /> : null}
      />

      {schools.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<School className="h-6 w-6" />}
            title="No schools yet"
            action={canCreate ? <AddSchoolButton label="Add your first school" /> : null}
          >
            {canCreate
              ? "Each school gets its own 3D floor plans, equipment register, Wi-Fi, cabinets, trolleys and cable runs."
              : "An admin hasn't added any schools to this workspace yet."}
          </EmptyState>
        </Panel>
      ) : (
        <div className="space-y-6">
          <nav aria-label="Quick actions" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Link href={planHref} className={tile}>
              <span className={tileIcon}>
                <Box className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-medium group-hover:text-accent">Open a floor plan</span>
                <span className="block text-xs text-muted">Rooms, stairs, Wi-Fi and cabling</span>
              </span>
            </Link>
            <Link href="/assets" className={tile}>
              <span className={tileIcon}>
                <Boxes className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-medium group-hover:text-accent">Find equipment</span>
                <span className="block text-xs text-muted">Search by name, tag, serial or IP</span>
              </span>
            </Link>
            {canAssets ? (
              <Link href="/assets?import=1" className={tile}>
                <span className={tileIcon}>
                  <Upload className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-medium group-hover:text-accent">Import a spreadsheet</span>
                  <span className="block text-xs text-muted">Add lots of devices from CSV</span>
                </span>
              </Link>
            ) : null}
            {canTeam ? (
              <Link href="/settings/team" className={tile}>
                <span className={tileIcon}>
                  <UserPlus className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-medium group-hover:text-accent">Invite your team</span>
                  <span className="block text-xs text-muted">Technicians, admins and viewers</span>
                </span>
              </Link>
            ) : null}
          </nav>

          <Readout
            readings={[
              { label: "Schools", value: stats.schoolCount, detail: `${formatNumber(stats.roomCount)} rooms mapped` },
              { label: "Equipment", value: stats.assetCount, detail: `${formatNumber(stats.containerCount)} cabinets and trolleys` },
              { label: "Wi-Fi access points", value: stats.accessPointCount, detail: `${formatNumber(stats.cableMetres)} m of cabling mapped` },
              {
                label: "Warranty alerts",
                value: stats.warranty.expired + stats.warranty.expiringSoon,
                tone: stats.warranty.expired > 0 ? "danger" : "warning",
                detail: `${formatNumber(stats.warranty.expired)} expired, ${formatNumber(stats.warranty.expiringSoon)} due within 90 days`,
              },
            ]}
          />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <Panel
              title="Schools"
              action={canAssets ? <AddAssetButton size="sm" variant="secondary" schools={assetOptions.schools} rooms={assetOptions.rooms} cabinets={assetOptions.cabinets} /> : null}
            >
              <SchoolsTable schools={schools} />
            </Panel>
            <Panel title="Warranty watchlist" description="Expired in the last 30 days or due in the next 90.">
              <WarrantyList items={stats.warranty.upcoming} showSchool />
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Equipment mix">
              <AssetMix items={stats.assetsByType} total={stats.assetCount} />
            </Panel>
            <Panel title="Recent activity">
              <ActivityFeed items={stats.activity} />
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
