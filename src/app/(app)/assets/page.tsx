import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Boxes, Search } from "lucide-react";
import { requirePageAuth } from "@/lib/auth/context";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getAssetFormOptions, toDateInput } from "@/lib/asset-options";
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS } from "@/lib/labels";
import { ASSET_STATUSES, ASSET_TYPES } from "@/lib/validation";
import { PageHeader } from "@/components/app/page-header";
import { Badge, EmptyState, Panel, type Tone } from "@/components/ui/panel";
import { buttonClasses } from "@/components/ui/button-classes";
import { AddAssetButton, EditAssetButton } from "@/components/assets/asset-form";
import { ImportAssetsButton } from "@/components/assets/import-dialog";
import { Download } from "lucide-react";
import { cn, daysUntil, formatDate, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Assets" };

const PAGE_SIZE = 50;
const STATUS_TONE: Record<string, Tone> = { ACTIVE: "success", IN_REPAIR: "warning", IN_STORAGE: "neutral", RETIRED: "neutral" };

type SearchParams = Promise<Record<string, string | undefined>>;

export default async function AssetsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageAuth();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 100);
  const schoolId = params.school ?? "";
  const type = ASSET_TYPES.includes(params.type as (typeof ASSET_TYPES)[number]) ? params.type! : "";
  const status = ASSET_STATUSES.includes(params.status as (typeof ASSET_STATUSES)[number]) ? params.status! : "";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.AssetWhereInput = {
    organisationId: ctx.organisation.id,
    ...(schoolId ? { schoolId } : {}),
    ...(type ? { type: type as Prisma.AssetWhereInput["type"] } : {}),
    ...(status ? { status: status as Prisma.AssetWhereInput["status"] } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { assetTag: { contains: q, mode: "insensitive" } },
            { serialNumber: { contains: q, mode: "insensitive" } },
            { manufacturer: { contains: q, mode: "insensitive" } },
            { model: { contains: q, mode: "insensitive" } },
            { ipAddress: { contains: q, mode: "insensitive" } },
            { assignedTo: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [options, total, assets] = await Promise.all([
    getAssetFormOptions(ctx.organisation.id),
    db.asset.count({ where }),
    db.asset.findMany({
      where,
      orderBy: [{ school: { name: "asc" } }, { assetTag: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        school: { select: { name: true } },
        room: { select: { name: true, floor: { select: { name: true, building: { select: { name: true } } } } } },
      },
    }),
  ]);

  const canWrite = can(ctx.role, "asset:write");
  const canDelete = can(ctx.role, "asset:delete");
  const filtered = Boolean(q || schoolId || type || status);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (schoolId) sp.set("school", schoolId);
    if (type) sp.set("type", type);
    if (status) sp.set("status", status);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/assets${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Assets"
        description="Every device across your schools. Search by name, tag, serial number, IP address or who it's assigned to."
        actions={
          <>
            {can(ctx.role, "report:export") && total > 0 ? (
              <a href={`/api/assets/export${schoolId ? `?school=${encodeURIComponent(schoolId)}` : ""}`} className={buttonClasses("ghost", "md")} download>
                <Download className="h-4 w-4" />
                Export CSV
              </a>
            ) : null}
            {canWrite && options.schools.length > 0 ? <ImportAssetsButton defaultOpen={params.import === "1"} /> : null}
            {canWrite ? <AddAssetButton schools={options.schools} rooms={options.rooms} cabinets={options.cabinets} /> : null}
          </>
        }
      />

      <form className="mb-5 grid gap-3 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]" role="search">
        <label className="relative">
          <span className="sr-only">Search assets</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search name, tag, serial, IP…" className="field-input pl-9" />
        </label>
        <select name="school" defaultValue={schoolId} className="field-input" aria-label="School">
          <option value="">All schools</option>
          {options.schools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={type} className="field-input" aria-label="Type">
          <option value="">All types</option>
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status} className="field-input" aria-label="Status">
          <option value="">Any status</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ASSET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="submit" className={buttonClasses("primary", "md", "flex-1")}>
            Search
          </button>
          {filtered ? (
            <Link href="/assets" className={buttonClasses("ghost", "md")}>
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {assets.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Boxes className="h-6 w-6" />}
            title={filtered ? "Nothing matches those filters" : "No equipment yet"}
            action={!filtered && canWrite ? <AddAssetButton schools={options.schools} rooms={options.rooms} cabinets={options.cabinets} label="Add your first device" /> : null}
          >
            {filtered
              ? "Try a different search, or clear the filters."
              : options.schools.length === 0
                ? "Add a school first, then you can record its equipment."
                : "Record a device here, or add it straight onto a room from the floor plan."}
          </EmptyState>
        </Panel>
      ) : (
        <Panel bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-5 py-3 font-medium">Device</th>
                  <th className="px-3 py-3 font-medium">Tag</th>
                  <th className="px-3 py-3 font-medium">Location</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Warranty</th>
                  {canWrite ? <th className="px-5 py-3"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {assets.map((a) => {
                  const days = a.warrantyExpiry ? daysUntil(a.warrantyExpiry) : null;
                  return (
                    <tr key={a.id} className="transition-colors hover:bg-surface-2/40">
                      <td className="px-5 py-3">
                        <p className="font-medium">{a.name}</p>
                        <p className="text-xs text-muted">
                          {ASSET_TYPE_LABELS[a.type]}
                          {a.manufacturer || a.model ? `, ${[a.manufacturer, a.model].filter(Boolean).join(" ")}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-mono text-xs">{a.assetTag}</span>
                        {a.ipAddress ? <p className="font-mono text-[11px] text-muted">{a.ipAddress}</p> : null}
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/schools/${a.schoolId}/map${a.roomId ? `?room=${a.roomId}` : ""}`} className="hover:text-accent">
                          {a.room ? a.room.name : <span className="text-muted">No room</span>}
                        </Link>
                        <p className="text-xs text-muted">{a.school.name}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={STATUS_TONE[a.status]}>{ASSET_STATUS_LABELS[a.status]}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <span className={cn("text-xs", days !== null && days < 0 && "text-danger", days !== null && days >= 0 && days <= 90 && "text-warning")}>
                          {a.warrantyExpiry ? formatDate(a.warrantyExpiry) : <span className="text-muted">Not recorded</span>}
                        </span>
                      </td>
                      {canWrite ? (
                        <td className="px-5 py-3 text-right">
                          <EditAssetButton
                            canDelete={canDelete}
                            schools={options.schools}
                            rooms={options.rooms}
                            cabinets={options.cabinets}
                            asset={{
                              id: a.id,
                              schoolId: a.schoolId,
                              roomId: a.roomId,
                              type: a.type,
                              name: a.name,
                              assetTag: a.assetTag,
                              manufacturer: a.manufacturer,
                              model: a.model,
                              serialNumber: a.serialNumber,
                              ipAddress: a.ipAddress,
                              macAddress: a.macAddress,
                              assignedTo: a.assignedTo,
                              status: a.status,
                              purchaseDate: toDateInput(a.purchaseDate),
                              warrantyExpiry: toDateInput(a.warrantyExpiry),
                              notes: a.notes,
                              cabinetId: a.cabinetId,
                              rackPosition: a.rackPosition,
                              rackUnits: a.rackUnits,
                            }}
                          />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-muted">
            <span>
              {formatNumber(total)} {total === 1 ? "device" : "devices"}
              {pages > 1 ? `, page ${page} of ${pages}` : ""}
            </span>
            {pages > 1 ? (
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className={buttonClasses("secondary", "sm")}>
                    Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link href={pageHref(page + 1)} className={buttonClasses("secondary", "sm")}>
                    Next
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </Panel>
      )}
    </>
  );
}
