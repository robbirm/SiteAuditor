"use client";

import { AlertTriangle, Server, ShoppingCart, Wifi } from "lucide-react";
import { AddAssetButton, EditAssetButton, type AssetValues, type CabinetOption, type RoomOption, type SchoolOption } from "@/components/assets/asset-form";
import { Badge } from "@/components/ui/panel";
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Options = { schools: SchoolOption[]; rooms: RoomOption[]; cabinets: CabinetOption[] };

const TYPE_COLOUR: Record<string, string> = {
  SWITCH: "#5BA8F5",
  ROUTER: "#9B8CF5",
  FIREWALL: "#F0616D",
  SERVER: "#3DD68C",
  NAS: "#22D3EE",
  UPS: "#F2B544",
  OTHER: "#A3B1C2",
};

function Header({ icon, kicker, title, onClose, actions }: { icon: React.ReactNode; kicker: string; title: string; onClose: () => void; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line/70 p-5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs text-muted">
          {icon}
          {kicker}
        </p>
        <h2 className="mt-1 truncate font-display text-lg font-semibold">{title}</h2>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <button onClick={onClose} className="px-1 text-xs text-muted hover:text-fg">
          Done
        </button>
      </div>
    </div>
  );
}

function Details({ asset }: { asset: AssetValues }) {
  const rows: [string, string | null][] = [
    ["Asset tag", asset.assetTag],
    ["Make and model", [asset.manufacturer, asset.model].filter(Boolean).join(" ") || null],
    ["IP address", asset.ipAddress],
    ["Serial number", asset.serialNumber],
    ["Warranty", asset.warrantyExpiry],
  ];
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
          <dt className="text-muted">{label}</dt>
          <dd className={cn("truncate", !value && "text-muted/70", label === "Asset tag" || label === "IP address" ? "font-mono text-xs leading-5" : "")}>{value ?? "Not recorded"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AccessPointPanel({
  ap,
  roomName,
  canEdit,
  canDelete,
  options,
  onClose,
}: {
  ap: AssetValues;
  roomName: string | null;
  canEdit: boolean;
  canDelete: boolean;
  options: Options;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <Header
        icon={<Wifi className="h-3.5 w-3.5 text-sky-400" />}
        kicker={`Access point${roomName ? `, ${roomName}` : ""}`}
        title={ap.name}
        onClose={onClose}
        actions={canEdit ? <EditAssetButton asset={ap} schools={options.schools} rooms={options.rooms} cabinets={options.cabinets} canDelete={canDelete} /> : null}
      />
      <div className="space-y-4 p-5">
        {ap.status !== "ACTIVE" ? (
          <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" />
            {ASSET_STATUS_LABELS[ap.status]}
          </p>
        ) : null}
        <Details asset={ap} />
        <p className="text-xs text-muted">
          The dashed ring is a rough 12 m coverage guide, not a survey. {canEdit ? "Drag the access point to move it; drop it in another room to move it there." : ""}
        </p>
      </div>
    </div>
  );
}

export function CabinetPanel({
  cabinet,
  contents,
  roomName,
  schoolId,
  canEdit,
  canDelete,
  options,
  onClose,
}: {
  cabinet: AssetValues;
  contents: AssetValues[];
  roomName: string | null;
  schoolId: string;
  canEdit: boolean;
  canDelete: boolean;
  options: Options;
  onClose: () => void;
}) {
  const size = cabinet.rackUnits ?? 42;
  const mounted = contents.filter((c) => c.rackPosition).sort((a, b) => (b.rackPosition ?? 0) - (a.rackPosition ?? 0));
  const loose = contents.filter((c) => !c.rackPosition);
  const used = contents.reduce((n, c) => n + (c.rackUnits ?? 1), 0);

  // Map each U to the item whose top occupies it, detecting clashes.
  const byTopU = new Map<number, AssetValues>();
  const occupied = new Map<number, string>();
  const clashes: string[] = [];
  for (const item of mounted) {
    const bottom = item.rackPosition!;
    const height = item.rackUnits ?? 1;
    const top = bottom + height - 1;
    let clash = top > size;
    for (let u = bottom; u <= top; u++) if (occupied.has(u)) clash = true;
    if (clash) {
      clashes.push(item.name);
      continue;
    }
    for (let u = bottom; u <= top; u++) occupied.set(u, item.id);
    byTopU.set(top, item);
  }

  const slots: React.ReactNode[] = [];
  for (let u = size; u >= 1; ) {
    const item = byTopU.get(u);
    if (item) {
      const h = item.rackUnits ?? 1;
      slots.push(
        <li key={u} className="flex items-stretch gap-2" style={{ minHeight: h * 16 }}>
          <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-[10px] text-muted">{u}</span>
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] border px-2 text-xs"
            style={{ borderColor: `${TYPE_COLOUR[item.type] ?? "#A3B1C2"}80`, background: `${TYPE_COLOUR[item.type] ?? "#A3B1C2"}22` }}
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{item.name}</span>
              <span className="text-muted"> {ASSET_TYPE_LABELS[item.type]}{h > 1 ? `, ${h}U` : ""}</span>
            </span>
            {item.status !== "ACTIVE" ? <Badge tone="warning">{ASSET_STATUS_LABELS[item.status]}</Badge> : null}
            {canEdit ? <EditAssetButton asset={item} schools={options.schools} rooms={options.rooms} cabinets={options.cabinets} canDelete={canDelete} /> : null}
          </div>
        </li>,
      );
      u -= h;
    } else {
      slots.push(
        <li key={u} className="flex h-4 items-center gap-2">
          <span className="w-7 shrink-0 text-right font-mono text-[10px] text-muted/60">{u}</span>
          <span className="h-px flex-1 bg-line/70" />
        </li>,
      );
      u -= 1;
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <Header
        icon={<Server className="h-3.5 w-3.5 text-accent" />}
        kicker={`Server cabinet${roomName ? `, ${roomName}` : ""}`}
        title={cabinet.name}
        onClose={onClose}
        actions={canEdit ? <EditAssetButton asset={cabinet} schools={options.schools} rooms={options.rooms} cabinets={options.cabinets} canDelete={canDelete} /> : null}
      />
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-xl font-semibold tabular-nums">
              {used} <span className="text-sm font-normal text-muted">of {size}U used</span>
            </p>
            <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (used / size) * 100)}%` }} />
            </div>
          </div>
          {canEdit ? (
            <AddAssetButton
              size="sm"
              label="Add to cabinet"
              schools={options.schools}
              rooms={options.rooms}
              cabinets={options.cabinets}
              defaults={{ schoolId, cabinetId: cabinet.id, type: "SWITCH" }}
            />
          ) : null}
        </div>

        {contents.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing recorded in this cabinet yet. Add switches, patch panels, servers or a UPS.</p>
        ) : (
          <>
            <div className="rounded-xl border border-line bg-bg/60 p-2">
              <ol className="max-h-[360px] space-y-[2px] overflow-y-auto pr-1">{slots}</ol>
            </div>
            {clashes.length ? (
              <p className="flex items-start gap-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {clashes.join(", ")} {clashes.length === 1 ? "overlaps" : "overlap"} another device or goes past the top of the cabinet. Edit the position to fix it.
              </p>
            ) : null}
            {loose.length ? (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">In the cabinet, position not set</p>
                <ul className="divide-y divide-line/60 rounded-xl border border-line">
                  {loose.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: TYPE_COLOUR[item.type] ?? "#A3B1C2" }} />
                      <span className="min-w-0 flex-1 truncate">
                        {item.name} <span className="text-xs text-muted">{ASSET_TYPE_LABELS[item.type]}</span>
                      </span>
                      {canEdit ? <EditAssetButton asset={item} schools={options.schools} rooms={options.rooms} cabinets={options.cabinets} canDelete={canDelete} /> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
        <Details asset={cabinet} />
      </div>
    </div>
  );
}

export function TrolleyPanel({
  trolley,
  contents,
  roomName,
  schoolId,
  canEdit,
  canDelete,
  options,
  onClose,
}: {
  trolley: AssetValues;
  contents: AssetValues[];
  roomName: string | null;
  schoolId: string;
  canEdit: boolean;
  canDelete: boolean;
  options: Options;
  onClose: () => void;
}) {
  const bays = trolley.rackUnits ?? 32;
  const byType = new Map<string, number>();
  for (const c of contents) byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
  const issues = contents.filter((c) => c.status !== "ACTIVE");
  const over = contents.length > bays;

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <Header
        icon={<ShoppingCart className="h-3.5 w-3.5 text-amber-400" />}
        kicker={`Charging trolley${roomName ? `, ${roomName}` : ""}`}
        title={trolley.name}
        onClose={onClose}
        actions={canEdit ? <EditAssetButton asset={trolley} schools={options.schools} rooms={options.rooms} cabinets={options.cabinets} canDelete={canDelete} /> : null}
      />
      <div className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={cn("font-display text-xl font-semibold tabular-nums", over && "text-warning")}>
              {contents.length} <span className="text-sm font-normal text-muted">of {bays} bays</span>
            </p>
            <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
              <div className={cn("h-full rounded-full", over ? "bg-warning" : "bg-amber-400")} style={{ width: `${Math.min(100, (contents.length / bays) * 100)}%` }} />
            </div>
          </div>
          {canEdit ? (
            <AddAssetButton
              size="sm"
              label="Add devices"
              schools={options.schools}
              rooms={options.rooms}
              cabinets={options.cabinets}
              defaults={{ schoolId, cabinetId: trolley.id, type: "LAPTOP" }}
            />
          ) : null}
        </div>

        {byType.size > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {[...byType.entries()].map(([type, n]) => (
              <span key={type} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs">
                <span className="font-semibold tabular-nums">{n}</span> {ASSET_TYPE_LABELS[type]?.toLowerCase()}
                {n === 1 ? "" : "s"}
              </span>
            ))}
          </div>
        ) : null}

        {issues.length ? (
          <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            {issues.length} {issues.length === 1 ? "device isn't" : "devices aren't"} in use (in repair or storage).
          </p>
        ) : null}

        {contents.length === 0 ? (
          <p className="text-[13px] text-muted">This trolley is empty. Add its laptops, Chromebooks or iPads; you can add a whole set at once.</p>
        ) : (
          <ul className="max-h-[320px] divide-y divide-line/60 overflow-y-auto rounded-xl border border-line">
            {contents
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
              .map((item) => (
                <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {item.name}{" "}
                    <span className="font-mono text-[11px] text-muted">{item.assetTag}</span>
                  </span>
                  {item.status !== "ACTIVE" ? <Badge tone="warning">{ASSET_STATUS_LABELS[item.status]}</Badge> : null}
                  {canEdit ? <EditAssetButton asset={item} schools={options.schools} rooms={options.rooms} cabinets={options.cabinets} canDelete={canDelete} /> : null}
                </li>
              ))}
          </ul>
        )}
        <Details asset={trolley} />
      </div>
    </div>
  );
}
