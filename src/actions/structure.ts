"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { getBuildingOrThrow, getFloorOrThrow, getRoomOrThrow, getSchoolOrThrow } from "@/lib/tenant";
import { fromZod, toActionError, type ActionState } from "@/lib/action-result";
import { buildingSchema, floorSchema, formToObject, idSchema, roomSchema } from "@/lib/validation";

const refresh = (schoolId: string) => {
  revalidatePath(`/schools/${schoolId}`);
  revalidatePath(`/schools/${schoolId}/map`);
  revalidatePath("/dashboard");
};

// ─── Buildings ───────────────────────────────────────────────────────────

export async function createBuildingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const school = await getSchoolOrThrow(ctx.organisation.id, idSchema.parse(formData.get("schoolId")));
    const parsed = buildingSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);

    const count = await db.building.count({ where: { schoolId: school.id } });
    const building = await db.$transaction(async (tx) => {
      const created = await tx.building.create({
        data: { ...parsed.data, schoolId: school.id, sortOrder: count },
      });
      // Every building starts with a ground floor so rooms can be added straight away.
      await tx.floor.create({ data: { buildingId: created.id, name: "Ground floor", level: 0 } });
      return created;
    });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "building.created",
      entityType: "building",
      entityId: building.id,
      summary: `${ctx.user.name} added ${building.name} to ${school.name}`,
    });
    refresh(school.id);
    return { ok: true, message: `${building.name} added.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateBuildingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const building = await getBuildingOrThrow(ctx.organisation.id, idSchema.parse(formData.get("buildingId")));
    const parsed = buildingSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    await db.building.update({ where: { id: building.id }, data: parsed.data });
    refresh(building.schoolId);
    return { ok: true, message: "Building updated." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteBuildingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const building = await getBuildingOrThrow(ctx.organisation.id, idSchema.parse(formData.get("buildingId")));
    await db.building.delete({ where: { id: building.id } });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "building.deleted",
      entityType: "building",
      entityId: building.id,
      summary: `${ctx.user.name} removed building ${building.name}`,
    });
    refresh(building.schoolId);
    return { ok: true, message: `${building.name} removed.` };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Floors ──────────────────────────────────────────────────────────────

export async function createFloorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const building = await getBuildingOrThrow(ctx.organisation.id, idSchema.parse(formData.get("buildingId")));
    const parsed = floorSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    await db.floor.create({ data: { ...parsed.data, buildingId: building.id } });
    refresh(building.schoolId);
    return { ok: true, message: `${parsed.data.name} added.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteFloorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const floor = await getFloorOrThrow(ctx.organisation.id, idSchema.parse(formData.get("floorId")));
    await db.floor.delete({ where: { id: floor.id } });
    refresh(floor.building.schoolId);
    return { ok: true, message: `${floor.name} removed.` };
  } catch (error) {
    return toActionError(error);
  }
}

// ─── Rooms ───────────────────────────────────────────────────────────────

export async function createRoomAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const floor = await getFloorOrThrow(ctx.organisation.id, idSchema.parse(formData.get("floorId")));
    const parsed = roomSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);

    // Lay new rooms out on a simple grid so they're visible on the map (Phase 3).
    const existing = await db.room.count({ where: { floorId: floor.id } });
    const col = existing % 5;
    const row = Math.floor(existing / 5);
    await db.room.create({
      data: {
        ...parsed.data,
        floorId: floor.id,
        schoolId: floor.building.schoolId,
        x: 40 + col * 220,
        y: 40 + row * 170,
      },
    });
    refresh(floor.building.schoolId);
    return { ok: true, message: `${parsed.data.name} added.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateRoomAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const room = await getRoomOrThrow(ctx.organisation.id, idSchema.parse(formData.get("roomId")));
    const parsed = roomSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    await db.room.update({ where: { id: room.id }, data: parsed.data });
    refresh(room.schoolId);
    return { ok: true, message: "Room updated." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteRoomAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("structure:manage");
    const room = await getRoomOrThrow(ctx.organisation.id, idSchema.parse(formData.get("roomId")));
    await db.room.delete({ where: { id: room.id } });
    refresh(room.schoolId);
    return { ok: true, message: `${room.name} removed. Its equipment is now unassigned.` };
  } catch (error) {
    return toActionError(error);
  }
}
