"use client";

import { useActionState, useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { createAssetAction, deleteAssetAction, updateAssetAction } from "@/actions/assets";
import { DeleteButton } from "@/components/ui/action-form";
import { Button, SubmitButton, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, Select, Textarea } from "@/components/ui/field";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import { safeAction } from "@/components/ui/safe-action";
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { ASSET_STATUSES, ASSET_TYPES } from "@/lib/validation";

const safeCreateAsset = safeAction(createAssetAction);
const safeUpdateAsset = safeAction(updateAssetAction);

export type SchoolOption = { id: string; name: string };
export type RoomOption = { id: string; schoolId: string; name: string; group: string };
export type CabinetOption = { id: string; schoolId: string; name: string; assetTag: string; kind?: "CABINET" | "TROLLEY"; roomName: string | null };

export type AssetValues = {
  id: string;
  schoolId: string;
  roomId: string | null;
  type: string;
  name: string;
  assetTag: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  assignedTo: string | null;
  status: string;
  purchaseDate: string | null; // yyyy-mm-dd
  warrantyExpiry: string | null;
  notes: string | null;
  cabinetId: string | null;
  rackPosition: number | null;
  rackUnits: number | null;
  /** Position within the room on the floor plan (access points and cabinets). */
  mapX?: number | null;
  mapY?: number | null;
};

type Defaults = { schoolId?: string; roomId?: string; cabinetId?: string; type?: string };

function AssetForm({
  asset,
  defaults,
  schools,
  rooms,
  cabinets = [],
  onDone,
}: {
  asset?: AssetValues;
  defaults?: Defaults;
  schools: SchoolOption[];
  rooms: RoomOption[];
  cabinets?: CabinetOption[];
  onDone: () => void;
}) {
  const [state, action] = useActionState(asset ? safeUpdateAsset : safeCreateAsset, {});
  useActionFeedback(state, onDone);
  const fe = state.fieldErrors;
  const [schoolId, setSchoolId] = useState(asset?.schoolId ?? defaults?.schoolId ?? schools[0]?.id ?? "");
  const [type, setType] = useState(asset?.type ?? defaults?.type ?? (defaults?.cabinetId ? "SWITCH" : "DESKTOP"));
  const [cabinetId, setCabinetId] = useState(asset?.cabinetId ?? defaults?.cabinetId ?? "");
  const schoolCabinets = cabinets.filter((c) => c.schoolId === schoolId && c.id !== asset?.id);
  const isContainer = type === "CABINET" || type === "TROLLEY";
  const container = schoolCabinets.find((c) => c.id === cabinetId);
  const inCabinet = !isContainer && Boolean(container);
  const inRack = inCabinet && (container?.kind ?? "CABINET") === "CABINET";

  // Rooms for the chosen school, grouped by building and floor.
  const groups = useMemo(() => {
    const map = new Map<string, RoomOption[]>();
    for (const r of rooms.filter((r) => r.schoolId === schoolId)) {
      map.set(r.group, [...(map.get(r.group) ?? []), r]);
    }
    return [...map.entries()];
  }, [rooms, schoolId]);

  return (
    <form action={action} className="space-y-4" noValidate>
      {asset ? <input type="hidden" name="assetId" value={asset.id} /> : null}
      <FormError message={state.error && !state.ok ? state.error : undefined} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" name="type" errors={fe?.type}>
          <Select id="f-type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {ASSET_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" name="name" required defaultValue={asset?.name} placeholder="e.g. Teacher PC" errors={fe?.name} />
      </div>
      {!asset && !isContainer ? (
        <Field
          label="How many?"
          name="quantity"
          type="number"
          min={1}
          max={100}
          defaultValue={1}
          hint="Adding a set, like 30 iPads for a trolley? Each gets its own number and asset tag."
          errors={fe?.quantity}
          className="max-w-[220px]"
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="School" name="schoolId" errors={fe?.schoolId}>
          <Select
            id="f-schoolId"
            name="schoolId"
            value={schoolId}
            onChange={(e) => {
              setSchoolId(e.target.value);
              setCabinetId("");
            }}
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Room" name="roomId" errors={fe?.roomId} hint={inCabinet ? "Set by the cabinet it's mounted in" : undefined}>
          <Select
            id="f-roomId"
            name="roomId"
            key={schoolId}
            disabled={inCabinet}
            defaultValue={asset?.schoolId === schoolId ? (asset?.roomId ?? "") : (defaults?.roomId ?? "")}
          >
            <option value="">Not in a room yet</option>
            {groups.map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </div>

      {type === "CABINET" ? (
        <Field
          label="Cabinet size (U)"
          name="rackUnits"
          type="number"
          min={1}
          max={60}
          defaultValue={asset?.rackUnits ?? 42}
          hint="Total rack units, e.g. 42, 24 or 12"
          errors={fe?.rackUnits}
        />
      ) : type === "TROLLEY" ? (
        <Field
          label="Bays"
          name="rackUnits"
          type="number"
          min={1}
          max={60}
          defaultValue={asset?.rackUnits ?? 32}
          hint="How many devices it holds"
          errors={fe?.rackUnits}
        />
      ) : schoolCabinets.length > 0 ? (
        <div className={cn("grid gap-4 rounded-xl border border-line/70 bg-bg/40 p-3", inRack && "sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]")}>
          <Field label="Stored in" name="cabinetId" errors={fe?.cabinetId}>
            <Select id="f-cabinetId" name="cabinetId" value={cabinetId} onChange={(e) => setCabinetId(e.target.value)}>
              <option value="">Not in a cabinet or trolley</option>
              {(["CABINET", "TROLLEY"] as const).map((kind) => {
                const list = schoolCabinets.filter((c) => (c.kind ?? "CABINET") === kind);
                if (list.length === 0) return null;
                return (
                  <optgroup key={kind} label={kind === "CABINET" ? "Server cabinets" : "Trolleys"}>
                    {list.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.assetTag}){c.roomName ? `, ${c.roomName}` : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          </Field>
          {inRack ? (
            <>
              <Field label="Position (U)" name="rackPosition" type="number" min={1} max={60} defaultValue={asset?.rackPosition ?? ""} hint="Lowest U" errors={fe?.rackPosition} />
              <Field label="Height (U)" name="rackUnits" type="number" min={1} max={60} defaultValue={asset?.rackUnits ?? 1} errors={fe?.rackUnits} />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Asset tag" name="assetTag" defaultValue={asset?.assetTag ?? ""} placeholder="Auto" hint={asset ? undefined : "Leave blank to generate"} errors={fe?.assetTag} />
        <Field label="Manufacturer" name="manufacturer" defaultValue={asset?.manufacturer ?? ""} errors={fe?.manufacturer} />
        <Field label="Model" name="model" defaultValue={asset?.model ?? ""} errors={fe?.model} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Serial number" name="serialNumber" defaultValue={asset?.serialNumber ?? ""} errors={fe?.serialNumber} />
        <Field label="IP address" name="ipAddress" defaultValue={asset?.ipAddress ?? ""} placeholder="10.20.1.15" errors={fe?.ipAddress} />
        <Field label="MAC address" name="macAddress" defaultValue={asset?.macAddress ?? ""} errors={fe?.macAddress} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Assigned to" name="assignedTo" defaultValue={asset?.assignedTo ?? ""} placeholder="Person or class" errors={fe?.assignedTo} />
        <Field label="Status" name="status" errors={fe?.status}>
          <Select id="f-status" name="status" defaultValue={asset?.status ?? "ACTIVE"}>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ASSET_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Purchase date" name="purchaseDate" type="date" defaultValue={asset?.purchaseDate ?? ""} errors={fe?.purchaseDate} />
        <Field label="Warranty expires" name="warrantyExpiry" type="date" defaultValue={asset?.warrantyExpiry ?? ""} errors={fe?.warrantyExpiry} />
      </div>

      <Field label="Notes" name="notes" errors={fe?.notes}>
        <Textarea id="f-notes" name="notes" defaultValue={asset?.notes ?? ""} rows={2} />
      </Field>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">{asset ? "Save changes" : "Add equipment"}</SubmitButton>
      </div>
    </form>
  );
}

export function AddAssetButton({
  schools,
  rooms,
  cabinets,
  defaults,
  label = "Add equipment",
  ...buttonProps
}: ButtonProps & { schools: SchoolOption[]; rooms: RoomOption[]; cabinets?: CabinetOption[]; defaults?: Defaults; label?: string }) {
  const [open, setOpen] = useState(false);
  if (schools.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button {...buttonProps}>
          <Plus className="h-4 w-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title="Add equipment" description="Only type, name and school are required. You can fill in the rest later." className="sm:max-w-2xl">
        <AssetForm schools={schools} rooms={rooms} cabinets={cabinets} defaults={defaults} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function EditAssetButton({
  asset,
  schools,
  rooms,
  cabinets,
  canDelete,
}: {
  asset: AssetValues;
  schools: SchoolOption[];
  rooms: RoomOption[];
  cabinets?: CabinetOption[];
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button className="inline-flex h-7 items-center rounded-md px-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Edit ${asset.name}`} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </DialogTrigger>
        <DialogContent title={`Edit ${asset.name}`} description={asset.assetTag} className="sm:max-w-2xl">
          <AssetForm asset={asset} schools={schools} rooms={rooms} cabinets={cabinets} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
      {canDelete ? <DeleteButton action={deleteAssetAction} hidden={{ assetId: asset.id }} label={`Delete ${asset.name}`} /> : null}
    </div>
  );
}
