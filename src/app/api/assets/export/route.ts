import { NextResponse, type NextRequest } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { ASSET_CSV_COLUMNS } from "@/lib/asset-csv";
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Exports the organisation's assets (optionally one school) in the import format. */
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Sign in to export." }, { status: 401 });
  if (!can(ctx.role, "report:export")) return NextResponse.json({ error: "Your role can't export data." }, { status: 403 });

  const schoolId = request.nextUrl.searchParams.get("school") || undefined;
  const assets = await db.asset.findMany({
    where: { organisationId: ctx.organisation.id, ...(schoolId ? { schoolId } : {}) },
    orderBy: [{ school: { name: "asc" } }, { assetTag: "asc" }],
    include: {
      school: { select: { name: true } },
      room: { select: { name: true, floor: { select: { name: true, building: { select: { name: true } } } } } },
      cabinet: { select: { assetTag: true } },
    },
  });

  const rows = [
    ASSET_CSV_COLUMNS.map((c) => c.header),
    ...assets.map((a) => {
      const values: Record<string, string> = {
        school: a.school.name,
        building: a.room?.floor.building.name ?? "",
        floor: a.room?.floor.name ?? "",
        room: a.room?.name ?? "",
        type: ASSET_TYPE_LABELS[a.type] ?? a.type,
        name: a.name,
        assetTag: a.assetTag,
        manufacturer: a.manufacturer ?? "",
        model: a.model ?? "",
        serialNumber: a.serialNumber ?? "",
        ipAddress: a.ipAddress ?? "",
        macAddress: a.macAddress ?? "",
        assignedTo: a.assignedTo ?? "",
        status: ASSET_STATUS_LABELS[a.status] ?? a.status,
        purchaseDate: day(a.purchaseDate),
        warrantyExpiry: day(a.warrantyExpiry),
        cabinet: a.cabinet?.assetTag ?? "",
        rackPosition: a.rackPosition?.toString() ?? "",
        rackUnits: a.rackUnits?.toString() ?? "",
        notes: a.notes ?? "",
      };
      return ASSET_CSV_COLUMNS.map((c) => values[c.key] ?? "");
    }),
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="schoolverse-assets-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
