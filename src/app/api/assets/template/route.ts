import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/csv";
import { ASSET_CSV_COLUMNS } from "@/lib/asset-csv";

export const dynamic = "force-dynamic";

/**
 * A ready-to-fill CSV template. Example rows use the caller's own school and
 * room names where possible, so they import cleanly as a test.
 */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Sign in to download the template." }, { status: 401 });

  const room = await db.room.findFirst({
    where: { school: { organisationId: ctx.organisation.id } },
    orderBy: { createdAt: "asc" },
    select: { name: true, school: { select: { name: true } }, floor: { select: { name: true, building: { select: { name: true } } } } },
  });
  const school = room?.school.name ?? (await db.school.findFirst({ where: { organisationId: ctx.organisation.id }, select: { name: true } }))?.name ?? "Your school name";
  const building = room?.floor.building.name ?? "";
  const floor = room?.floor.name ?? "";
  const roomName = room?.name ?? "";

  const header = ASSET_CSV_COLUMNS.map((c) => c.header);
  const example = (values: Record<string, string>) => ASSET_CSV_COLUMNS.map((c) => values[c.key] ?? "");
  const rows = [
    header,
    example({ school, building, floor, room: roomName, type: "Server cabinet", name: "Cabinet A", assetTag: "CAB-0001", manufacturer: "APC", model: "NetShelter SX 42U", rackUnits: "42" }),
    example({ school, building, floor, room: roomName, type: "Switch", name: "Core switch", manufacturer: "Aruba", model: "CX 6100 48G", serialNumber: "SG12AB3456", ipAddress: "10.0.0.2", status: "In use", warrantyExpiry: "2028-03-31", cabinet: "CAB-0001", rackPosition: "40", rackUnits: "1" }),
    example({ school, building, floor, room: roomName, type: "Access point", name: "AP Library", manufacturer: "Ubiquiti", model: "U6 Pro", ipAddress: "10.0.10.21", purchaseDate: "15/09/2024", warrantyExpiry: "15/09/2027" }),
    example({ school, building, floor, room: roomName, type: "Charging trolley", name: "Year 5 iPad trolley", assetTag: "TRL-0001", manufacturer: "LocknCharge", model: "Carrier 30", rackUnits: "30" }),
    example({ school, type: "Tablet", name: "Year 5 iPad 1", manufacturer: "Apple", model: "iPad (10th gen)", cabinet: "TRL-0001" }),
    example({ school, building, floor, room: roomName, type: "Laptop", name: "Teacher laptop", manufacturer: "Lenovo", model: "ThinkPad E14", serialNumber: "PF3ABC12", assignedTo: "J. Smith", status: "In use", notes: "Delete these example rows before importing" }),
  ];

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="schoolverse-assets-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
