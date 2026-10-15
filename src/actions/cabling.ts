"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, NotFoundError } from "@/lib/auth/context";
import { getFloorOrThrow } from "@/lib/tenant";
import { fromZod, toActionError, type ActionState } from "@/lib/action-result";
import { CABLE_SHORT_LABELS, pathLengthMetres, type CablePoint } from "@/lib/cabling";
import { cableRunCreateSchema, cableRunMetaSchema, cableRunPointsSchema, formToObject, idSchema } from "@/lib/validation";

/** Rounds points to whole map units so stored paths stay tidy. */
const tidy = (points: CablePoint[]) => points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));

/** Which room (if any) on the floor contains a point. Smallest room wins where rooms overlap. */
async function roomAt(floorId: string, point: CablePoint): Promise<string | null> {
  const rooms = await db.room.findMany({ where: { floorId }, select: { id: true, x: true, y: true, width: true, height: true } });
  const hits = rooms
    .filter((r) => point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return hits[0]?.id ?? null;
}

async function endpoints(floorId: string, points: CablePoint[]) {
  const [fromRoomId, toRoomId] = await Promise.all([roomAt(floorId, points[0]!), roomAt(floorId, points[points.length - 1]!)]);
  return { fromRoomId, toRoomId };
}

async function getRunOrThrow(organisationId: string, id: string) {
  const run = await db.cableRun.findFirst({ where: { id, organisationId } });
  if (!run) throw new NotFoundError("Cable run not found.");
  return run;
}

const refresh = (schoolId: string) => {
  revalidatePath(`/schools/${schoolId}/map`);
  revalidatePath(`/schools/${schoolId}`);
};

/** Saves a newly drawn run. Called directly from the floor builder. */
export async function createCableRunAction(input: {
  floorId: string;
  name: string;
  type: string;
  notes?: string;
  points: CablePoint[];
}): Promise<ActionState> {
  try {
    const ctx = await authorize("network:write");
    const parsed = cableRunCreateSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const floor = await getFloorOrThrow(ctx.organisation.id, parsed.data.floorId);
    const points = tidy(parsed.data.points);

    const run = await db.cableRun.create({
      data: {
        organisationId: ctx.organisation.id,
        schoolId: floor.building.schoolId,
        floorId: floor.id,
        name: parsed.data.name,
        type: parsed.data.type,
        notes: parsed.data.notes,
        points,
        lengthMetres: pathLengthMetres(points),
        ...(await endpoints(floor.id, points)),
      },
    });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "cable.created",
      entityType: "cableRun",
      entityId: run.id,
      summary: `${ctx.user.name} mapped a ${CABLE_SHORT_LABELS[run.type]} run: ${run.name} (${run.lengthMetres} m)`,
    });
    refresh(floor.building.schoolId);
    return { ok: true, message: `${run.name} saved (${run.lengthMetres} m).`, data: { cableRunId: run.id } };
  } catch (error) {
    return toActionError(error);
  }
}

/** Saves a reshaped path after a bend point is dragged. */
export async function updateCableRunPointsAction(input: { cableRunId: string; points: CablePoint[] }): Promise<ActionState> {
  try {
    const ctx = await authorize("network:write");
    const parsed = cableRunPointsSchema.safeParse(input);
    if (!parsed.success) return { error: "That cable path isn't valid." };
    const run = await getRunOrThrow(ctx.organisation.id, parsed.data.cableRunId);
    const points = tidy(parsed.data.points);
    await db.cableRun.update({
      where: { id: run.id },
      data: { points, lengthMetres: pathLengthMetres(points), ...(await endpoints(run.floorId, points)) },
    });
    refresh(run.schoolId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateCableRunAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("network:write");
    const run = await getRunOrThrow(ctx.organisation.id, idSchema.parse(formData.get("cableRunId")));
    const parsed = cableRunMetaSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    await db.cableRun.update({ where: { id: run.id }, data: parsed.data });
    refresh(run.schoolId);
    return { ok: true, message: "Cable run saved." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteCableRunAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("network:write");
    const run = await getRunOrThrow(ctx.organisation.id, idSchema.parse(formData.get("cableRunId")));
    await db.cableRun.delete({ where: { id: run.id } });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "cable.deleted",
      entityType: "cableRun",
      entityId: run.id,
      summary: `${ctx.user.name} removed cable run ${run.name}`,
    });
    refresh(run.schoolId);
    return { ok: true, message: `${run.name} removed.` };
  } catch (error) {
    return toActionError(error);
  }
}
