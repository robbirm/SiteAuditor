import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/auth/context";

/**
 * Tenant-scoped lookups. Every lookup by id includes the caller's
 * organisationId in the WHERE clause, so a guessed or leaked id from another
 * organisation resolves to "not found" rather than another tenant's data.
 * Server code must use these helpers (or an equivalent organisationId filter)
 * and never `findUnique({ where: { id } })` on tenant data.
 */

export async function getSchoolOrThrow(organisationId: string, schoolId: string) {
  const school = await db.school.findFirst({ where: { id: schoolId, organisationId } });
  if (!school) throw new NotFoundError("School not found.");
  return school;
}

export async function getBuildingOrThrow(organisationId: string, buildingId: string) {
  const building = await db.building.findFirst({
    where: { id: buildingId, school: { organisationId } },
  });
  if (!building) throw new NotFoundError("Building not found.");
  return building;
}

export async function getFloorOrThrow(organisationId: string, floorId: string) {
  const floor = await db.floor.findFirst({
    where: { id: floorId, building: { school: { organisationId } } },
    include: { building: { select: { schoolId: true } } },
  });
  if (!floor) throw new NotFoundError("Floor not found.");
  return floor;
}

export async function getRoomOrThrow(organisationId: string, roomId: string) {
  const room = await db.room.findFirst({ where: { id: roomId, school: { organisationId } } });
  if (!room) throw new NotFoundError("Room not found.");
  return room;
}
