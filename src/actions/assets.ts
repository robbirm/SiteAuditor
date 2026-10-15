"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type AssetType } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize, NotFoundError } from "@/lib/auth/context";
import { getSchoolOrThrow } from "@/lib/tenant";
import { fromZod, toActionError, type ActionState } from "@/lib/action-result";
import { assetPositionSchema, assetSchema, formToObject, idSchema } from "@/lib/validation";
import { getFloorOrThrow } from "@/lib/tenant";
import { ASSET_TYPE_LABELS, isContainerType } from "@/lib/labels";
import { z } from "zod";

const TAG_PREFIX: Record<string, string> = {
  DESKTOP: "PC", LAPTOP: "LT", CHROMEBOOK: "CB", TABLET: "TB", PRINTER: "PR", PROJECTOR: "PJ",
  INTERACTIVE_DISPLAY: "IFP", ACCESS_POINT: "AP", SWITCH: "SW", ROUTER: "RT", FIREWALL: "FW",
  SERVER: "SRV", NAS: "NAS", UPS: "UPS", PHONE: "PH", CAMERA: "CAM", CABINET: "CAB", TROLLEY: "TRL", OTHER: "AS",
};

/** Next free tag like "PC-0042" for this organisation. */
async function nextAssetTag(organisationId: string, type: AssetType): Promise<string> {
  const prefix = TAG_PREFIX[type] ?? "AS";
  const count = await db.asset.count({ where: { organisationId, type } });
  for (let n = count + 1; n < count + 500; n++) {
    const tag = `${prefix}-${String(n).padStart(4, "0")}`;
    const taken = await db.asset.findFirst({ where: { organisationId, assetTag: tag }, select: { id: true } });
    if (!taken) return tag;
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

/** Confirms the room (if any) belongs to the chosen school in this organisation. */
async function checkRoom(organisationId: string, schoolId: string, roomId: string | null) {
  if (!roomId) return;
  const room = await db.room.findFirst({ where: { id: roomId, schoolId, school: { organisationId } }, select: { id: true } });
  if (!room) throw new NotFoundError("That room isn't part of the chosen school.");
}

type AssetInput = ReturnType<typeof assetSchema.parse>;

/**
 * Validates storage and fills in the room: a device kept in a cabinet or
 * trolley lives in that container's room. Containers can't be nested; rack
 * positions only apply inside cabinets.
 */
async function resolveCabinet(organisationId: string, schoolId: string, data: AssetInput, selfId?: string): Promise<AssetInput> {
  if (data.type === "CABINET") return { ...data, cabinetId: null, rackPosition: null, rackUnits: data.rackUnits ?? 42 };
  if (data.type === "TROLLEY") return { ...data, cabinetId: null, rackPosition: null, rackUnits: data.rackUnits ?? 32 };
  if (!data.cabinetId) return { ...data, rackPosition: null };
  if (data.cabinetId === selfId) throw new NotFoundError("A device can't be stored inside itself.");
  const container = await db.asset.findFirst({
    where: { id: data.cabinetId, organisationId, schoolId, type: { in: ["CABINET", "TROLLEY"] } },
    select: { id: true, roomId: true, type: true },
  });
  if (!container) throw new NotFoundError("That cabinet or trolley isn't part of the chosen school.");
  if (container.type === "TROLLEY") return { ...data, roomId: container.roomId ?? data.roomId, rackPosition: null, rackUnits: null };
  return { ...data, roomId: container.roomId ?? data.roomId, rackUnits: data.rackUnits ?? 1 };
}

function refresh(schoolId: string) {
  revalidatePath("/assets");
  revalidatePath("/dashboard");
  revalidatePath(`/schools/${schoolId}`);
  revalidatePath(`/schools/${schoolId}/map`);
}

const quantitySchema = z.coerce.number().int().min(1).max(100).catch(1);

export async function createAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("asset:write");
    const parsed = assetSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const data = parsed.data;
    const quantity = quantitySchema.parse(formData.get("quantity") ?? 1);
    if (quantity > 1 && data.assetTag) {
      return { fieldErrors: { assetTag: ["Leave the asset tag blank when adding more than one; each gets its own tag."] } };
    }
    if (quantity > 1 && isContainerType(data.type)) {
      return { fieldErrors: { quantity: ["Add cabinets and trolleys one at a time."] } };
    }

    const school = await getSchoolOrThrow(ctx.organisation.id, parsed.data.schoolId);
    const resolved = await resolveCabinet(ctx.organisation.id, school.id, data);
    await checkRoom(ctx.organisation.id, school.id, resolved.roomId);

    const created: { name: string; assetTag: string }[] = [];
    for (let i = 1; i <= quantity; i++) {
      const assetTag = resolved.assetTag ?? (await nextAssetTag(ctx.organisation.id, resolved.type));
      const name = quantity > 1 ? `${resolved.name} ${i}` : resolved.name;
      const asset = await db.asset.create({
        data: {
          ...resolved,
          name,
          assetTag,
          organisationId: ctx.organisation.id,
          // Stack rack-mounted multiples upwards rather than in one slot.
          rackPosition: resolved.rackPosition ? resolved.rackPosition + (i - 1) * (resolved.rackUnits ?? 1) : resolved.rackPosition,
        },
      });
      created.push({ name: asset.name, assetTag: asset.assetTag });
    }
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "asset.created",
      entityType: "asset",
      summary:
        quantity > 1
          ? `${ctx.user.name} added ${quantity} × ${ASSET_TYPE_LABELS[resolved.type].toLowerCase()} (${resolved.name}) at ${school.name}`
          : `${ctx.user.name} added ${ASSET_TYPE_LABELS[resolved.type].toLowerCase()} ${created[0]!.name} (${created[0]!.assetTag}) at ${school.name}`,
    });
    refresh(school.id);
    return {
      ok: true,
      message:
        quantity > 1
          ? `${quantity} devices added (${created[0]!.assetTag} to ${created[created.length - 1]!.assetTag}).`
          : `${created[0]!.name} added as ${created[0]!.assetTag}.`,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { fieldErrors: { assetTag: ["Another device already uses this asset tag."] } };
    }
    return toActionError(error);
  }
}

export async function updateAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("asset:write");
    const id = idSchema.parse(formData.get("assetId"));
    const existing = await db.asset.findFirst({ where: { id, organisationId: ctx.organisation.id }, select: { id: true, schoolId: true, assetTag: true, roomId: true } });
    if (!existing) throw new NotFoundError("Asset not found.");

    const parsed = assetSchema.safeParse(formToObject(formData));
    if (!parsed.success) return fromZod(parsed.error);
    const data = parsed.data;

    const school = await getSchoolOrThrow(ctx.organisation.id, parsed.data.schoolId);
    const resolved = await resolveCabinet(ctx.organisation.id, school.id, data, id);
    await checkRoom(ctx.organisation.id, school.id, resolved.roomId);

    const moved = existing.schoolId !== school.id;
    await db.asset.update({
      where: { id },
      data: {
        ...resolved,
        assetTag: resolved.assetTag ?? existing.assetTag,
        // A new room (or school) means the old map position no longer applies.
        ...(moved || resolved.roomId !== existing.roomId ? { mapX: null, mapY: null } : {}),
      },
    });
    if (isContainerType(resolved.type) && resolved.roomId !== existing.roomId) {
      // Devices in the cabinet or trolley move with it.
      await db.asset.updateMany({ where: { cabinetId: id, organisationId: ctx.organisation.id }, data: { roomId: resolved.roomId } });
    }
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "asset.updated",
      entityType: "asset",
      entityId: id,
      summary: `${ctx.user.name} updated ${data.name}`,
    });
    refresh(school.id);
    if (moved) refresh(existing.schoolId);
    return { ok: true, message: `${data.name} saved.` };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { fieldErrors: { assetTag: ["Another device already uses this asset tag."] } };
    }
    return toActionError(error);
  }
}

export async function deleteAssetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await authorize("asset:delete");
    const id = idSchema.parse(formData.get("assetId"));
    const asset = await db.asset.findFirst({ where: { id, organisationId: ctx.organisation.id }, select: { id: true, name: true, assetTag: true, schoolId: true } });
    if (!asset) throw new NotFoundError("Asset not found.");
    await db.asset.delete({ where: { id: asset.id } });
    await audit({
      organisationId: ctx.organisation.id,
      userId: ctx.user.id,
      action: "asset.deleted",
      entityType: "asset",
      entityId: asset.id,
      summary: `${ctx.user.name} deleted ${asset.name} (${asset.assetTag})`,
    });
    refresh(asset.schoolId);
    return { ok: true, message: `${asset.name} deleted.` };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Moves an access point or cabinet on the floor plan. `mapX`/`mapY` arrive as
 * floor coordinates; they're stored relative to the room the device lands in,
 * so it travels with the room when the room is moved.
 */
export async function updateAssetPositionAction(input: { assetId: string; floorId: string; mapX: number; mapY: number }): Promise<ActionState> {
  try {
    const ctx = await authorize("asset:write");
    const parsed = assetPositionSchema.safeParse(input);
    if (!parsed.success) return { error: "That position isn't valid." };
    const { assetId, floorId, mapX, mapY } = parsed.data;
    const floor = await getFloorOrThrow(ctx.organisation.id, floorId);
    const asset = await db.asset.findFirst({
      where: { id: assetId, organisationId: ctx.organisation.id, schoolId: floor.building.schoolId },
      select: { id: true, schoolId: true },
    });
    if (!asset) throw new NotFoundError("Asset not found.");

    const rooms = await db.room.findMany({ where: { floorId: floor.id }, select: { id: true, x: true, y: true, width: true, height: true } });
    const room = rooms
      .filter((r) => mapX >= r.x && mapX <= r.x + r.width && mapY >= r.y && mapY <= r.y + r.height)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    if (!room) return { error: "Drop it inside a room." };

    await db.$transaction([
      db.asset.update({
        where: { id: asset.id },
        data: { roomId: room.id, mapX: Math.round(mapX - room.x), mapY: Math.round(mapY - room.y) },
      }),
      // Anything installed in a cabinet moves with it.
      db.asset.updateMany({ where: { cabinetId: asset.id, organisationId: ctx.organisation.id }, data: { roomId: room.id } }),
    ]);
    refresh(asset.schoolId);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
