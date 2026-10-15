"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { getFloorOrThrow, getRoomOrThrow } from "@/lib/tenant";
import { fromZod, toActionError, type ActionState } from "@/lib/action-result";
import { formToObject, idSchema, MAP_UNITS_PER_METRE as M, mapRoomSchema, roomGeometrySchema } from "@/lib/validation";

type Rect = { x: number; y: number; width: number; height: number };

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** First free spot on a 1 m grid, scanning left-to-right then front-to-back. */
function findFreeSpot(existing: Rect[], width: number, height: number, areaWidth: number): { x: number; y: number } {
  const rowWidth = Math.max(areaWidth, width + 2 * M);
  for (let y = 0; y < 400 * M; y += M) {
    for (let x = 0; x + width <= rowWidth; x += M) {
      const candidate = { x, y, width, height };
      if (!existing.some((r) => overlaps(candidate, r))) return { x, y };
    }
  }
  const maxY = existing.reduce((m, r) => Math.max(m, r.y + r.height), 0);
  return { x: 0, y: maxY + M };
}

/** Saves a room's position and size after it's dragged or resized on the map. */
export async function updateRoomGeometryAction(input: {
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const parsed = roomGeometrySchema.safeParse(input);
    if (!parsed.success) return { error: "That size or position isn't allowed." };
    const { roomId, ...geometry } = parsed.data;
    const room = await getRoomOrThrow(ctx.organisation.id, roomId);
    await db.room.update({ where: { id: room.id }, data: geometry });
    revalidatePath(`/schools/${room.schoolId}/map`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Adds a room to a floor at the first free spot on the map. */
export async function createRoomOnMapAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const floor = await getFloorOrThrow(ctx.organisation.id, idSchema.parse(formData.get("floorId")));
    const parsed = mapRoomSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const { name, type, widthM, depthM } = parsed.data;

    const width = widthM * M;
    const height = depthM * M;
    const existing = await db.room.findMany({
      where: { floorId: floor.id },
      select: { x: true, y: true, width: true, height: true },
    });
    const spot = findFreeSpot(existing, width, height, Math.max(floor.planWidth, 40 * M));

    const room = await db.room.create({
      data: { name, type, floorId: floor.id, schoolId: floor.building.schoolId, ...spot, width, height },
    });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "room.created",
      entityType: "room",
      entityId: room.id,
      summary: `${ctx.user.name} added ${room.name} to the floor plan`,
    });
    revalidatePath(`/schools/${floor.building.schoolId}/map`);
    revalidatePath(`/schools/${floor.building.schoolId}`);
    return { ok: true, message: `${room.name} added. Drag it into place.`, data: { roomId: room.id } };
  } catch (error) {
    return toActionError(error);
  }
}
