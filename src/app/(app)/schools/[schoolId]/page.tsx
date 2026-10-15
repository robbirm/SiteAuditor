import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAuth } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getDashboardStats } from "@/lib/stats";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/ui/panel";
import { DeleteSchoolButton, EditSchoolButton } from "@/components/schools/school-dialogs";
import { StructureManager, type BuildingNode } from "@/components/schools/structure-manager";
import { AssetMix, Readout, WarrantyList } from "@/components/dashboard/widgets";
import { formatNumber } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button-classes";
import { AddAssetButton } from "@/components/assets/asset-form";
import { getAssetFormOptions } from "@/lib/asset-options";
import { IsoScene } from "@/components/map/iso-scene";
import { fitViewBox, groundBounds } from "@/components/map/iso";
import { floorMarkers } from "@/components/map/markers";
import { Box } from "lucide-react";

type Params = { params: Promise<{ schoolId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { schoolId } = await params;
  const ctx = await requirePageAuth();
  const school = await db.school.findFirst({ where: { id: schoolId, organisationId: ctx.organisation.id }, select: { name: true } });
  return { title: school?.name ?? "School" };
}

export default async function SchoolPage({ params }: Params) {
  const { schoolId } = await params;
  const ctx = await requirePageAuth();

  // Organisation filter: a school id from another workspace is a 404, not a leak.
  const school = await db.school.findFirst({
    where: { id: schoolId, organisationId: ctx.organisation.id },
    include: {
      buildings: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          floors: {
            orderBy: { level: "asc" },
            include: {
              rooms: {
                orderBy: { name: "asc" },
                include: { _count: { select: { assets: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!school) notFound();

  const [stats, assetOptions] = await Promise.all([
    getDashboardStats(ctx.organisation.id, school.id),
    getAssetFormOptions(ctx.organisation.id),
  ]);

  // Preview the busiest floor in 3D.
  const previewFloor = school.buildings
    .flatMap((b) => b.floors.map((f) => ({ ...f, label: `${b.name} / ${f.name}` })))
    .sort((a, b) => b.rooms.length - a.rooms.length)[0];
  const previewRooms = previewFloor
    ? await db.room.findMany({
        where: { floorId: previewFloor.id },
        select: {
          id: true, name: true, type: true, x: true, y: true, width: true, height: true,
          assets: { select: { id: true, name: true, type: true, status: true, cabinetId: true, rackUnits: true, mapX: true, mapY: true } },
        },
      })
    : [];
  const previewMarkers = floorMarkers(previewRooms);
  const sceneRooms = previewRooms.map((r) => ({ ...r, devices: previewMarkers.devicesByRoom.get(r.id) ?? [] }));
  const previewCables = previewFloor
    ? (
        await db.cableRun.findMany({
          where: { floorId: previewFloor.id, organisationId: ctx.organisation.id },
          select: { id: true, name: true, type: true, points: true, lengthMetres: true },
        })
      ).map((c) => ({ ...c, points: Array.isArray(c.points) ? (c.points as { x: number; y: number }[]) : [] }))
    : [];
  const previewBox = fitViewBox(groundBounds(sceneRooms));
  const canEdit = can(ctx.role, "school:update");
  const canDelete = can(ctx.role, "school:delete");
  const canStructure = can(ctx.role, "structure:manage");

  const buildings: BuildingNode[] = school.buildings.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    floors: b.floors.map((f) => ({
      id: f.id,
      name: f.name,
      level: f.level,
      rooms: f.rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, capacity: r.capacity, assetCount: r._count.assets })),
    })),
  }));

  const details: [string, string | null][] = [
    ["Phase", school.phase],
    ["School code", school.code],
    ["Address", [school.address, school.postcode].filter(Boolean).join(", ") || null],
    ["Phone", school.phone],
    ["IT contact", [school.contactName, school.contactEmail].filter(Boolean).join(", ") || null],
    ["Pupils", school.pupilCount !== null ? formatNumber(school.pupilCount) : null],
    ["Staff", school.staffCount !== null ? formatNumber(school.staffCount) : null],
  ];

  return (
    <>
      <PageHeader
        crumb={
          <Link href="/schools" className="hover:text-fg">
            Schools
          </Link>
        }
        title={school.name}
        description={[school.phase, school.postcode].filter(Boolean).join(", ") || undefined}
        actions={
          <>
            <Link href={`/schools/${school.id}/map`} className={buttonClasses("primary", "sm")}>
              <Box className="h-3.5 w-3.5" />
              Floor plan
            </Link>
            {can(ctx.role, "asset:write") ? (
              <AddAssetButton size="sm" variant="secondary" schools={assetOptions.schools} rooms={assetOptions.rooms} cabinets={assetOptions.cabinets} defaults={{ schoolId: school.id }} />
            ) : null}
            {canEdit ? (
              <EditSchoolButton
                school={{
                  id: school.id,
                  name: school.name,
                  code: school.code,
                  phase: school.phase,
                  address: school.address,
                  postcode: school.postcode,
                  phone: school.phone,
                  contactName: school.contactName,
                  contactEmail: school.contactEmail,
                  pupilCount: school.pupilCount,
                  staffCount: school.staffCount,
                  notes: school.notes,
                }}
              />
            ) : null}
            {canDelete ? <DeleteSchoolButton schoolId={school.id} schoolName={school.name} /> : null}
          </>
        }
      />

      <div className="space-y-6">
        <Readout
          readings={[
            { label: "Rooms", value: stats.roomCount, detail: `${school.buildings.length} ${school.buildings.length === 1 ? "building" : "buildings"}` },
            { label: "Equipment", value: stats.assetCount, detail: `${formatNumber(stats.containerCount)} cabinets and trolleys` },
            { label: "Wi-Fi access points", value: stats.accessPointCount, detail: `${formatNumber(stats.cableMetres)} m of cabling mapped` },
            {
              label: "Warranty alerts",
              value: stats.warranty.expired + stats.warranty.expiringSoon,
              tone: stats.warranty.expired > 0 ? "danger" : "warning",
              detail: `${formatNumber(stats.warranty.expired)} expired, ${formatNumber(stats.warranty.expiringSoon)} due soon`,
            },
          ]}
        />

        {previewFloor && sceneRooms.length > 0 ? (
          <Link
            href={`/schools/${school.id}/map?floor=${previewFloor.id}`}
            className="group block overflow-hidden rounded-2xl border border-line bg-bg shadow-card transition-colors hover:border-accent/50"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-3">
              <div>
                <p className="font-display text-[15px] font-semibold group-hover:text-accent">{previewFloor.label}</p>
                <p className="text-[13px] text-muted">Click to open the floor plan: add rooms, stairs, equipment, trolleys and cable runs.</p>
              </div>
              <span className={buttonClasses("primary", "sm", "shrink-0")}>
                <Box className="h-3.5 w-3.5" />
                Open
              </span>
            </div>
            <svg
              viewBox={`${previewBox.x} ${previewBox.y} ${previewBox.width} ${previewBox.height}`}
              className="block h-[300px] w-full sm:h-[400px]"
              role="img"
              aria-label={`3D preview of ${previewFloor.label}`}
            >
              <IsoScene rooms={sceneRooms} cables={previewCables} accessPoints={previewMarkers.accessPoints} cabinets={previewMarkers.cabinets} trolleys={previewMarkers.trolleys} />
            </svg>
          </Link>
        ) : (
          <Link
            href={`/schools/${school.id}/map`}
            className="blueprint flex flex-col items-center gap-3 rounded-2xl border border-dashed border-accent/40 px-6 py-14 text-center transition-colors hover:border-accent"
          >
            <Box className="h-8 w-8 text-accent" />
            <span className="font-display text-lg font-semibold">Start the floor plan</span>
            <span className="max-w-md text-sm text-muted">Lay out the rooms, then add equipment, Wi-Fi, cabinets, trolleys and cable runs.</span>
          </Link>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title="Buildings and floors" description="Add floors here; lay out rooms on the floor plan.">
            <StructureManager schoolId={school.id} buildings={buildings} canManage={canStructure} />
          </Panel>

          <div className="space-y-6">
            <Panel title="Warranty watchlist">
              <WarrantyList items={stats.warranty.upcoming} showSchool={false} />
            </Panel>
            <Panel title="Equipment mix">
              <AssetMix items={stats.assetsByType} total={stats.assetCount} />
            </Panel>
            <Panel title="School details">
              <dl className="space-y-2.5 text-sm">
                {details.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className={value ? "" : "text-muted/70"}>{value ?? "Not set"}</dd>
                  </div>
                ))}
                {school.notes ? (
                  <div className="border-t border-line/70 pt-3">
                    <dt className="mb-1 text-muted">Notes</dt>
                    <dd className="whitespace-pre-line">{school.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
