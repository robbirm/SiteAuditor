"use server";

import { revalidatePath } from "next/cache";
import type { AssetType } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/auth/context";
import { toActionError } from "@/lib/action-result";
import { parseCsv } from "@/lib/csv";
import { mapCsvRows, parseAssetStatus, parseAssetType, parseCsvDate, type AssetCsvRow } from "@/lib/asset-csv";
import { assetSchema } from "@/lib/validation";

const MAX_BYTES = 2_000_000;
const MAX_ROWS = 2000;

export type ImportRowResult = {
  line: number;
  name: string;
  tag: string;
  school: string;
  action: "create" | "update" | "error";
  messages: string[];
};

export type ImportResult = {
  ok?: boolean;
  error?: string;
  committed?: boolean;
  created: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
};

const TAG_PREFIX: Record<string, string> = {
  DESKTOP: "PC", LAPTOP: "LT", CHROMEBOOK: "CB", TABLET: "TB", PRINTER: "PR", PROJECTOR: "PJ",
  INTERACTIVE_DISPLAY: "IFP", ACCESS_POINT: "AP", SWITCH: "SW", ROUTER: "RT", FIREWALL: "FW",
  SERVER: "SRV", NAS: "NAS", UPS: "UPS", PHONE: "PH", CAMERA: "CAM", CABINET: "CAB", TROLLEY: "TRL", OTHER: "AS",
};

const key = (v: string) => v.trim().toLowerCase();

/** Column names for validation messages. */
const FIELD_COLUMN: Record<string, string> = {
  schoolId: "school", roomId: "room", type: "type", name: "name", assetTag: "asset_tag", manufacturer: "manufacturer",
  model: "model", serialNumber: "serial_number", ipAddress: "ip_address", macAddress: "mac_address", assignedTo: "assigned_to",
  status: "status", purchaseDate: "purchase_date", warrantyExpiry: "warranty_expiry", notes: "notes",
  cabinetId: "stored_in", rackPosition: "rack_position_u", rackUnits: "rack_units",
};

type Planned = {
  line: number;
  raw: AssetCsvRow;
  messages: string[];
  existingId: string | null;
  data: Record<string, string>; // assetSchema input (strings), cabinet resolved later
  cabinetRef: string | null;
};

/**
 * Validates an asset CSV and, when `commit` is true, imports every valid row.
 * Rows whose asset tag already exists update that device; others are created.
 * Rows with problems are skipped and reported, never half-imported.
 */
export async function importAssetsAction(input: { csv: string; commit: boolean }): Promise<ImportResult> {
  const empty: ImportResult = { created: 0, updated: 0, failed: 0, rows: [] };
  try {
    const ctx = await authorize("asset:write");
    const orgId = ctx.organisation.id;
    if (typeof input?.csv !== "string" || input.csv.length === 0) return { ...empty, error: "Choose a CSV file to import." };
    if (input.csv.length > MAX_BYTES) return { ...empty, error: "That file is over 2 MB. Split it into smaller files." };

    const { rows, missing } = mapCsvRows(parseCsv(input.csv));
    if (missing.length) return { ...empty, error: `The file is missing required columns: ${missing.join(", ")}. Start from the template.` };
    if (rows.length === 0) return { ...empty, error: "The file has a header row but no devices." };
    if (rows.length > MAX_ROWS) return { ...empty, error: `That's ${rows.length} rows. Import up to ${MAX_ROWS} at a time.` };

    const [schools, rooms, existing] = await Promise.all([
      db.school.findMany({ where: { organisationId: orgId }, select: { id: true, name: true } }),
      db.room.findMany({
        where: { school: { organisationId: orgId } },
        select: { id: true, name: true, schoolId: true, floor: { select: { name: true, building: { select: { name: true } } } } },
      }),
      db.asset.findMany({ where: { organisationId: orgId }, select: { id: true, assetTag: true, type: true, name: true, schoolId: true, roomId: true } }),
    ]);
    const schoolByName = new Map(schools.map((s) => [key(s.name), s]));
    const existingByTag = new Map(existing.map((a) => [key(a.assetTag), a]));
    const seenTags = new Set<string>();

    // ── Pass 1: everything except cabinet references ──────────────────────
    const planned: Planned[] = rows.map((raw, i) => {
      const line = i + 2; // header is line 1
      const messages: string[] = [];

      let schoolId = "";
      if (raw.school) {
        const school = schoolByName.get(key(raw.school));
        if (school) schoolId = school.id;
        else messages.push(`School "${raw.school}" not found.`);
      } else if (schools.length === 1) {
        schoolId = schools[0]!.id;
      } else {
        messages.push("School is required.");
      }

      let roomId = "";
      if (raw.room && schoolId) {
        const candidates = rooms.filter(
          (r) =>
            r.schoolId === schoolId &&
            key(r.name) === key(raw.room!) &&
            (!raw.building || key(r.floor.building.name) === key(raw.building)) &&
            (!raw.floor || key(r.floor.name) === key(raw.floor)),
        );
        if (candidates.length === 1) roomId = candidates[0]!.id;
        else if (candidates.length === 0) messages.push(`Room "${raw.room}" not found in that school. Create it on the floor plan first.`);
        else messages.push(`More than one room is called "${raw.room}". Add the building and floor columns.`);
      }

      const type = parseAssetType(raw.type ?? "");
      if (!type) messages.push(raw.type ? `Type "${raw.type}" isn't recognised.` : "Type is required.");
      const status = parseAssetStatus(raw.status ?? "");
      if (!status) messages.push(`Status "${raw.status}" isn't recognised.`);
      const purchaseDate = parseCsvDate(raw.purchaseDate ?? "");
      if (purchaseDate === "invalid") messages.push(`Purchase date "${raw.purchaseDate}" isn't a valid date.`);
      const warrantyExpiry = parseCsvDate(raw.warrantyExpiry ?? "");
      if (warrantyExpiry === "invalid") messages.push(`Warranty date "${raw.warrantyExpiry}" isn't a valid date.`);

      const tag = raw.assetTag ?? "";
      let existingId: string | null = null;
      if (tag) {
        if (seenTags.has(key(tag))) messages.push(`Asset tag ${tag} appears more than once in this file.`);
        seenTags.add(key(tag));
        existingId = existingByTag.get(key(tag))?.id ?? null;
      }

      return {
        line,
        raw,
        messages,
        existingId,
        cabinetRef: raw.cabinet ? raw.cabinet : null,
        data: {
          schoolId,
          roomId,
          type: type ?? "",
          name: raw.name ?? "",
          assetTag: tag,
          manufacturer: raw.manufacturer ?? "",
          model: raw.model ?? "",
          serialNumber: raw.serialNumber ?? "",
          ipAddress: raw.ipAddress ?? "",
          macAddress: raw.macAddress ?? "",
          assignedTo: raw.assignedTo ?? "",
          status: status ?? "ACTIVE",
          purchaseDate: purchaseDate && purchaseDate !== "invalid" ? purchaseDate : "",
          warrantyExpiry: warrantyExpiry && warrantyExpiry !== "invalid" ? warrantyExpiry : "",
          notes: raw.notes ?? "",
          rackPosition: raw.rackPosition ?? "",
          rackUnits: raw.rackUnits ?? "",
        },
      };
    });

    // ── Pass 2: cabinet references (existing cabinets or ones in this file) ─
    const isContainer = (t: string) => t === "CABINET" || t === "TROLLEY";
    const fileCabinets = planned.filter((p) => isContainer(p.data.type) && p.messages.length === 0);
    for (const p of planned) {
      if (!p.cabinetRef || p.messages.length) continue;
      if (isContainer(p.data.type)) {
        p.messages.push("A cabinet or trolley can't be stored inside another one.");
        continue;
      }
      const ref = key(p.cabinetRef);
      const inDb = existing.filter(
        (a) => isContainer(a.type) && a.schoolId === p.data.schoolId && (key(a.assetTag) === ref || key(a.name) === ref),
      );
      const inFile = fileCabinets.filter(
        (c) => c.data.schoolId === p.data.schoolId && (key(c.data.assetTag) === ref || key(c.data.name) === ref),
      );
      if (inDb.length + inFile.length === 0) p.messages.push(`Cabinet or trolley "${p.cabinetRef}" not found in that school.`);
      else if (inDb.length + inFile.length > 1) p.messages.push(`More than one cabinet or trolley matches "${p.cabinetRef}". Use its asset tag.`);
    }

    // ── Validate each row with the same rules as the form ───────────────
    for (const p of planned) {
      if (p.messages.length) continue;
      const parsed = assetSchema.safeParse({ ...p.data, cabinetId: "" });
      if (!parsed.success) {
        for (const [field, errs] of Object.entries(parsed.error.flatten().fieldErrors)) {
          if (errs?.[0]) p.messages.push(`${FIELD_COLUMN[field] ?? field}: ${errs[0]}`);
        }
      }
    }

    const results: ImportRowResult[] = planned.map((p) => ({
      line: p.line,
      name: p.data.name || "(no name)",
      tag: p.data.assetTag || "new tag",
      school: p.raw.school ?? "",
      action: p.messages.length ? "error" : p.existingId ? "update" : "create",
      messages: p.messages,
    }));
    const valid = planned.filter((p) => p.messages.length === 0);
    const summary = {
      created: valid.filter((p) => !p.existingId).length,
      updated: valid.filter((p) => p.existingId).length,
      failed: planned.length - valid.length,
    };

    if (!input.commit) return { ok: true, committed: false, ...summary, rows: results.slice(0, 500) };
    if (valid.length === 0) return { ...summary, error: "None of the rows can be imported. Fix the problems listed and try again.", rows: results.slice(0, 500) };

    // ── Commit: cabinets first so other rows can be mounted in them ───────
    const usedTags = new Set(existing.map((a) => key(a.assetTag)));
    for (const p of valid) if (p.data.assetTag) usedTags.add(key(p.data.assetTag));
    const counters = new Map<string, number>();
    const nextTag = (type: string) => {
      const prefix = TAG_PREFIX[type] ?? "AS";
      let n = counters.get(prefix) ?? existing.filter((a) => a.type === type).length;
      let tag: string;
      do {
        n += 1;
        tag = `${prefix}-${String(n).padStart(4, "0")}`;
      } while (usedTags.has(key(tag)));
      counters.set(prefix, n);
      usedTags.add(key(tag));
      return tag;
    };

    const ordered = [...valid].sort((a, b) => Number(isContainer(b.data.type)) - Number(isContainer(a.data.type)));
    await db.$transaction(
      async (tx) => {
        const cabinetIds = new Map<string, { id: string; roomId: string | null; type: string }>(); // "schoolId|ref" -> container
        const remember = (schoolId: string, tag: string, name: string, id: string, roomId: string | null, type: string) => {
          cabinetIds.set(`${schoolId}|${key(tag)}`, { id, roomId, type });
          cabinetIds.set(`${schoolId}|${key(name)}`, { id, roomId, type });
        };
        for (const a of existing) if (isContainer(a.type)) remember(a.schoolId, a.assetTag, a.name, a.id, a.roomId, a.type);

        for (const p of ordered) {
          const parsed = assetSchema.parse({ ...p.data, cabinetId: "" });
          let cabinetId: string | null = null;
          let containerType: string | null = null;
          let roomId = parsed.roomId;
          if (p.cabinetRef) {
            const cab = cabinetIds.get(`${parsed.schoolId}|${key(p.cabinetRef)}`);
            cabinetId = cab?.id ?? null;
            containerType = cab?.type ?? null;
            roomId = cab?.roomId ?? roomId;
          }
          const inRack = containerType === "CABINET";
          const data = {
            ...parsed,
            roomId,
            cabinetId,
            type: parsed.type as AssetType,
            rackPosition: inRack ? parsed.rackPosition : null,
            rackUnits:
              parsed.type === "CABINET"
                ? (parsed.rackUnits ?? 42)
                : parsed.type === "TROLLEY"
                  ? (parsed.rackUnits ?? 32)
                  : inRack
                    ? (parsed.rackUnits ?? 1)
                    : cabinetId
                      ? null
                      : parsed.rackUnits,
          };

          const saved = p.existingId
            ? await tx.asset.update({
                where: { id: p.existingId },
                data: { ...data, assetTag: data.assetTag ?? undefined },
              })
            : await tx.asset.create({
                data: { ...data, assetTag: data.assetTag ?? nextTag(data.type), organisationId: orgId },
              });
          if (isContainer(saved.type)) remember(saved.schoolId, saved.assetTag, saved.name, saved.id, saved.roomId, saved.type);
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    await audit({
      organisationId: orgId,
      userId: ctx.user.id,
      action: "asset.imported",
      entityType: "asset",
      summary: `${ctx.user.name} imported assets from CSV: ${summary.created} added, ${summary.updated} updated${summary.failed ? `, ${summary.failed} skipped` : ""}`,
    });
    revalidatePath("/assets");
    revalidatePath("/dashboard");
    for (const s of schools) {
      revalidatePath(`/schools/${s.id}`);
      revalidatePath(`/schools/${s.id}/map`);
    }
    return { ok: true, committed: true, ...summary, rows: results.slice(0, 500) };
  } catch (error) {
    const e = toActionError(error);
    return { ...empty, error: e.error ?? "The import failed. Nothing was changed." };
  }
}
