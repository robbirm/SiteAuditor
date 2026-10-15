import "server-only";
import { db } from "@/lib/db";

/** School and room choices for asset forms, scoped to one organisation. */
export async function getAssetFormOptions(organisationId: string) {
  const [schools, cabinets, rooms] = await Promise.all([
    db.school.findMany({ where: { organisationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.asset.findMany({
      where: { organisationId, type: { in: ["CABINET", "TROLLEY"] } },
      select: { id: true, schoolId: true, name: true, assetTag: true, type: true, room: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    db.room.findMany({
      where: { school: { organisationId } },
      select: {
        id: true,
        name: true,
        schoolId: true,
        floor: { select: { name: true, level: true, building: { select: { name: true, sortOrder: true } } } },
      },
      orderBy: [{ name: "asc" }],
    }),
  ]);

  const roomOptions = rooms
    .sort(
      (a, b) =>
        a.floor.building.sortOrder - b.floor.building.sortOrder ||
        a.floor.level - b.floor.level ||
        a.name.localeCompare(b.name),
    )
    .map((r) => ({ id: r.id, schoolId: r.schoolId, name: r.name, group: `${r.floor.building.name} / ${r.floor.name}` }));

  return {
    schools,
    rooms: roomOptions,
    // Cabinets and trolleys: anything equipment can be stored in.
    cabinets: cabinets.map((c) => ({
      id: c.id,
      schoolId: c.schoolId,
      name: c.name,
      assetTag: c.assetTag,
      kind: c.type as "CABINET" | "TROLLEY",
      roomName: c.room?.name ?? null,
    })),
  };
}

export function toDateInput(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
