import "server-only";
import type { FaultStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const OPEN_FAULT_STATUSES: FaultStatus[] = ["OPEN", "IN_PROGRESS", "ON_HOLD"];
export const WARRANTY_WINDOW_DAYS = 90;

/**
 * All dashboard figures are computed live from the database. `schoolId`
 * narrows every query to one school; the organisation filter is always applied.
 */
export async function getDashboardStats(organisationId: string, schoolId?: string) {
  const now = new Date();
  const horizon = new Date(now.getTime() + WARRANTY_WINDOW_DAYS * 86_400_000);
  const scope = schoolId ? { organisationId, schoolId } : { organisationId };

  const liveAssets: Prisma.AssetWhereInput = { ...scope, status: { not: "RETIRED" } };
  const openFaults: Prisma.FaultWhereInput = { ...scope, status: { in: OPEN_FAULT_STATUSES } };

  const [
    schoolCount,
    assetCount,
    assetsByType,
    assetsByStatus,
    warrantyExpired,
    warrantyExpiring,
    upcomingWarranties,
    faultsByPriority,
    recentFaults,
    resolvedLast30,
    networkNodeCount,
    roomCount,
    activity,
    accessPointCount,
    containerCount,
    cableTotals,
  ] = await Promise.all([
    schoolId ? Promise.resolve(1) : db.school.count({ where: { organisationId } }),
    db.asset.count({ where: liveAssets }),
    db.asset.groupBy({ by: ["type"], where: liveAssets, _count: { _all: true } }),
    db.asset.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    db.asset.count({ where: { ...liveAssets, warrantyExpiry: { lt: now } } }),
    db.asset.count({ where: { ...liveAssets, warrantyExpiry: { gte: now, lte: horizon } } }),
    db.asset.findMany({
      where: { ...liveAssets, warrantyExpiry: { gte: new Date(now.getTime() - 30 * 86_400_000), lte: horizon } },
      orderBy: { warrantyExpiry: "asc" },
      take: 6,
      select: {
        id: true,
        name: true,
        assetTag: true,
        type: true,
        warrantyExpiry: true,
        school: { select: { id: true, name: true } },
      },
    }),
    db.fault.groupBy({ by: ["priority"], where: openFaults, _count: { _all: true } }),
    db.fault.findMany({
      where: openFaults,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        reference: true,
        title: true,
        priority: true,
        status: true,
        createdAt: true,
        school: { select: { id: true, name: true } },
        asset: { select: { name: true, assetTag: true } },
        room: { select: { name: true } },
      },
    }),
    db.fault.count({
      where: { ...scope, status: { in: ["RESOLVED", "CLOSED"] }, resolvedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
    }),
    db.networkNode.count({ where: scope }),
    db.room.count({
      where: { ...(schoolId ? { schoolId } : {}), school: { organisationId }, type: { notIn: ["STAIRS", "LIFT", "CORRIDOR"] } },
    }),
    // The organisation-wide feed only; school pages don't show it.
    db.auditLog.findMany({
      where: { organisationId },
      orderBy: { createdAt: "desc" },
      take: schoolId ? 0 : 8,
      select: { id: true, summary: true, createdAt: true, action: true, user: { select: { name: true } } },
    }),
    db.asset.count({ where: { ...liveAssets, type: "ACCESS_POINT" } }),
    db.asset.count({ where: { ...liveAssets, type: { in: ["CABINET", "TROLLEY"] } } }),
    db.cableRun.aggregate({ where: scope, _sum: { lengthMetres: true }, _count: { _all: true } }),
  ]);

  const priorityCount = (p: string) => faultsByPriority.find((f) => f.priority === p)?._count._all ?? 0;
  const openFaultCount = faultsByPriority.reduce((sum, f) => sum + f._count._all, 0);

  return {
    schoolCount,
    assetCount,
    roomCount,
    networkNodeCount,
    accessPointCount,
    containerCount,
    cableRuns: cableTotals._count._all,
    cableMetres: Math.round(cableTotals._sum.lengthMetres ?? 0),
    assetsByType: assetsByType
      .map((a) => ({ type: a.type, count: a._count._all }))
      .sort((a, b) => b.count - a.count),
    assetsByStatus: assetsByStatus.map((a) => ({ status: a.status, count: a._count._all })),
    warranty: { expired: warrantyExpired, expiringSoon: warrantyExpiring, upcoming: upcomingWarranties },
    faults: {
      open: openFaultCount,
      critical: priorityCount("CRITICAL"),
      high: priorityCount("HIGH"),
      medium: priorityCount("MEDIUM"),
      low: priorityCount("LOW"),
      resolvedLast30,
      recent: recentFaults,
    },
    activity,
  };
}

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

/** Per-school rollups for the schools list and dashboard table. */
export async function getSchoolSummaries(organisationId: string) {
  const schools = await db.school.findMany({
    where: { organisationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      phase: true,
      postcode: true,
      pupilCount: true,
      updatedAt: true,
      _count: {
        select: {
          buildings: true,
          rooms: true,
          assets: { where: { status: { not: "RETIRED" } } },
          faults: { where: { status: { in: OPEN_FAULT_STATUSES } } },
          networkNodes: true,
        },
      },
    },
  });

  // Warranty alerts per school in a single grouped query.
  const horizon = new Date(Date.now() + WARRANTY_WINDOW_DAYS * 86_400_000);
  const warranty = await db.asset.groupBy({
    by: ["schoolId"],
    where: { organisationId, status: { not: "RETIRED" }, warrantyExpiry: { lte: horizon } },
    _count: { _all: true },
  });
  const warrantyBySchool = new Map(warranty.map((w) => [w.schoolId, w._count._all]));

  return schools.map((s) => ({ ...s, warrantyAlerts: warrantyBySchool.get(s.id) ?? 0 }));
}

export type SchoolSummary = Awaited<ReturnType<typeof getSchoolSummaries>>[number];
