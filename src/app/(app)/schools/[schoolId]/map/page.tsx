import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAuth } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getAssetFormOptions, toDateInput } from "@/lib/asset-options";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/ui/panel";
import { buttonClasses } from "@/components/ui/button-classes";
import { FloorBuilder, type BuilderRoom } from "@/components/map/floor-builder";
import { FirstBuildingForm, FloorPicker } from "@/components/map/floor-picker";

export const metadata: Metadata = { title: "Floor plan" };

type Props = {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function MapPage({ params, searchParams }: Props) {
  const { schoolId } = await params;
  const { floor: floorParam, room: roomParam, mode: modeParam } = await searchParams;
  const ctx = await requirePageAuth();

  const school = await db.school.findFirst({
    where: { id: schoolId, organisationId: ctx.organisation.id },
    select: {
      id: true,
      name: true,
      buildings: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          name: true,
          floors: { orderBy: { level: "asc" }, select: { id: true, name: true, planWidth: true, _count: { select: { rooms: true } } } },
        },
      },
    },
  });
  if (!school) notFound();

  const floors = school.buildings.flatMap((b) =>
    b.floors.map((f) => ({ id: f.id, name: f.name, planWidth: f.planWidth, label: `${b.name} / ${f.name}`, roomCount: f._count.rooms })),
  );

  // A room link (?room=) opens the floor that room is on.
  let floorId = floorParam && floors.some((f) => f.id === floorParam) ? floorParam : undefined;
  if (!floorId && roomParam) {
    const room = await db.room.findFirst({ where: { id: roomParam, schoolId: school.id }, select: { floorId: true } });
    floorId = room?.floorId;
  }
  const floor = floors.find((f) => f.id === floorId) ?? floors.find((f) => f.roomCount > 0) ?? floors[0];

  const header = (
    <PageHeader
      crumb={
        <>
          <Link href="/schools" className="hover:text-fg">
            Schools
          </Link>
          {" / "}
          <Link href={`/schools/${school.id}`} className="hover:text-fg">
            {school.name}
          </Link>
        </>
      }
      title="Floor plan"
      description="A 3D view of each floor: lay out rooms, place equipment and trace cable runs."
      actions={
        floor ? (
          <>
            {floors.length > 1 ? <FloorPicker schoolId={school.id} currentFloorId={floor.id} floors={floors} /> : null}
            <Link href={`/schools/${school.id}`} className={buttonClasses("secondary", "sm")}>
              Buildings and floors
            </Link>
          </>
        ) : null
      }
    />
  );

  if (!floor) {
    return (
      <>
        {header}
        <Panel>
          {can(ctx.role, "structure:manage") ? (
            <div className="py-8">
              <FirstBuildingForm schoolId={school.id} />
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted">This school doesn&apos;t have any buildings mapped yet.</p>
          )}
        </Panel>
      </>
    );
  }

  const [rooms, cableRuns, assetOptions] = await Promise.all([
    db.room.findMany({
      where: { floorId: floor.id, school: { organisationId: ctx.organisation.id } },
      orderBy: { name: "asc" },
      include: { assets: { orderBy: [{ type: "asc" }, { name: "asc" }] } },
    }),
    db.cableRun.findMany({
      where: { floorId: floor.id, organisationId: ctx.organisation.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, points: true, lengthMetres: true, notes: true },
    }),
    getAssetFormOptions(ctx.organisation.id),
  ]);

  const cables = cableRuns.map((c) => ({
    ...c,
    points: Array.isArray(c.points) ? (c.points as { x: number; y: number }[]) : [],
  }));

  const builderRooms: BuilderRoom[] = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    capacity: r.capacity,
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
    devices: r.assets.map((a) => ({ id: a.id, name: a.name, type: a.type, status: a.status })),
    assets: r.assets.map((a) => ({
      id: a.id,
      schoolId: a.schoolId,
      roomId: a.roomId,
      type: a.type,
      name: a.name,
      assetTag: a.assetTag,
      manufacturer: a.manufacturer,
      model: a.model,
      serialNumber: a.serialNumber,
      ipAddress: a.ipAddress,
      macAddress: a.macAddress,
      assignedTo: a.assignedTo,
      status: a.status,
      purchaseDate: toDateInput(a.purchaseDate),
      warrantyExpiry: toDateInput(a.warrantyExpiry),
      notes: a.notes,
      cabinetId: a.cabinetId,
      rackPosition: a.rackPosition,
      rackUnits: a.rackUnits,
      mapX: a.mapX,
      mapY: a.mapY,
    })),
  }));

  const initialRoomId = roomParam && builderRooms.some((r) => r.id === roomParam) ? roomParam : null;

  return (
    <>
      {header}
      <FloorBuilder
        key={floor.id}
        schoolId={school.id}
        floor={{ id: floor.id, name: floor.label, planWidth: floor.planWidth }}
        rooms={builderRooms}
        cables={cables}
        initialMode={modeParam === "cabling" ? "cabling" : "rooms"}
        canEdit={can(ctx.role, "structure:manage")}
        canEditCables={can(ctx.role, "network:write")}
        canEditAssets={can(ctx.role, "asset:write")}
        canDeleteAssets={can(ctx.role, "asset:delete")}
        initialRoomId={initialRoomId}
        assetOptions={assetOptions}
      />
    </>
  );
}
