"use client";

import { useState } from "react";
import { Building2, ChevronDown, DoorOpen, Layers, Pencil, Plus } from "lucide-react";
import {
  createBuildingAction,
  createFloorAction,
  createRoomAction,
  deleteBuildingAction,
  deleteFloorAction,
  deleteRoomAction,
  updateBuildingAction,
  updateRoomAction,
} from "@/actions/structure";
import { ActionForm, DeleteButton } from "@/components/ui/action-form";
import { Button, SubmitButton } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/panel";
import { ROOM_TYPE_LABELS } from "@/lib/labels";
import { ROOM_TYPES } from "@/lib/validation";
import { cn } from "@/lib/utils";

export type RoomNode = { id: string; name: string; type: string; capacity: number | null; assetCount: number };
export type FloorNode = { id: string; name: string; level: number; rooms: RoomNode[] };
export type BuildingNode = { id: string; name: string; description: string | null; floors: FloorNode[] };

export function StructureManager({
  schoolId,
  buildings,
  canManage,
}: {
  schoolId: string;
  buildings: BuildingNode[];
  canManage: boolean;
}) {
  if (buildings.length === 0) {
    return (
      <EmptyState
        icon={<Building2 className="h-6 w-6" />}
        title="No buildings yet"
        action={canManage ? <BuildingDialog schoolId={schoolId} trigger={<Button><Plus className="h-4 w-4" />Add a building</Button>} /> : null}
      >
        {canManage
          ? "Start with the main building. Each one gets a ground floor you can add rooms to."
          : "Nobody has mapped this school's buildings yet."}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {buildings.map((b, i) => (
        <BuildingCard key={b.id} building={b} canManage={canManage} defaultOpen={i < 2} />
      ))}
      {canManage ? (
        <BuildingDialog
          schoolId={schoolId}
          trigger={
            <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-3 text-sm text-muted transition-colors hover:border-accent/50 hover:text-accent">
              <Plus className="h-4 w-4" />
              Add a building
            </button>
          }
        />
      ) : null}
    </div>
  );
}

function BuildingCard({ building, canManage, defaultOpen }: { building: BuildingNode; canManage: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const roomCount = building.floors.reduce((n, f) => n + f.rooms.length, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg/40">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left"
          aria-expanded={open}
        >
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition-transform", !open && "-rotate-90")} />
          <Building2 className="h-[18px] w-[18px] shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="block truncate font-medium">{building.name}</span>
            <span className="block text-xs text-muted">
              {building.floors.length} {building.floors.length === 1 ? "floor" : "floors"}, {roomCount} {roomCount === 1 ? "room" : "rooms"}
            </span>
          </span>
        </button>
        {canManage ? (
          <div className="flex shrink-0 items-center gap-1">
            <FloorDialog buildingId={building.id} />
            <BuildingDialog
              building={building}
              trigger={
                <button className="inline-flex h-7 items-center rounded-md px-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Rename ${building.name}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              }
            />
            <DeleteButton action={deleteBuildingAction} hidden={{ buildingId: building.id }} label={`Delete ${building.name}`} />
          </div>
        ) : null}
      </div>

      {open ? (
        <div className="space-y-3 border-t border-line px-3 py-3">
          {building.description ? <p className="px-1 text-[13px] text-muted">{building.description}</p> : null}
          {building.floors.map((floor) => (
            <FloorSection key={floor.id} floor={floor} canManage={canManage} canDeleteFloor={building.floors.length > 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FloorSection({ floor, canManage, canDeleteFloor }: { floor: FloorNode; canManage: boolean; canDeleteFloor: boolean }) {
  return (
    <div className="rounded-lg border border-line/70 bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Layers className="h-4 w-4 text-muted" />
          {floor.name}
          <span className="text-xs font-normal text-muted">level {floor.level}</span>
        </span>
        {canManage ? (
          <div className="flex items-center gap-1">
            <RoomDialog floorId={floor.id} />
            {canDeleteFloor ? <DeleteButton action={deleteFloorAction} hidden={{ floorId: floor.id }} label={`Delete ${floor.name}`} /> : null}
          </div>
        ) : null}
      </div>
      {floor.rooms.length === 0 ? (
        <p className="px-3 py-4 text-[13px] text-muted">{canManage ? "No rooms on this floor yet. Add the first one." : "No rooms on this floor."}</p>
      ) : (
        <ul className="divide-y divide-line/50">
          {floor.rooms.map((room) => (
            <li key={room.id} className="group flex items-center gap-3 px-3 py-2">
              <DoorOpen className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{room.name}</span>
                <span className="block text-xs text-muted">
                  {ROOM_TYPE_LABELS[room.type]}
                  {room.capacity ? `, seats ${room.capacity}` : ""}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs tabular-nums text-muted">
                {room.assetCount} {room.assetCount === 1 ? "asset" : "assets"}
              </span>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <RoomDialog room={room} />
                  <DeleteButton action={deleteRoomAction} hidden={{ roomId: room.id }} label={`Delete ${room.name}`} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────

function BuildingDialog({
  schoolId,
  building,
  trigger,
}: {
  schoolId?: string;
  building?: BuildingNode;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={building ? `Rename ${building.name}` : "Add a building"}>
        <ActionForm
          action={building ? updateBuildingAction : createBuildingAction}
          hidden={building ? { buildingId: building.id } : { schoolId: schoolId! }}
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          {(state) => (
            <>
              <Field label="Name" name="name" required defaultValue={building?.name} placeholder="e.g. Main block" errors={state.fieldErrors?.name} />
              <Field label="Description" name="description" defaultValue={building?.description ?? ""} placeholder="Optional" errors={state.fieldErrors?.description} />
              <div className="flex justify-end">
                <SubmitButton>{building ? "Save" : "Add building"}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function FloorDialog({ buildingId }: { buildingId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg">
          <Plus className="h-3.5 w-3.5" />
          Floor
        </button>
      </DialogTrigger>
      <DialogContent title="Add a floor">
        <ActionForm action={createFloorAction} hidden={{ buildingId }} onSuccess={() => setOpen(false)} className="space-y-4">
          {(state) => (
            <>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
                <Field label="Name" name="name" required placeholder="e.g. First floor" errors={state.fieldErrors?.name} />
                <Field label="Level" name="level" type="number" defaultValue={1} hint="0 is ground" errors={state.fieldErrors?.level} />
              </div>
              <div className="flex justify-end">
                <SubmitButton>Add floor</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

function RoomDialog({ floorId, room }: { floorId?: string; room?: RoomNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {room ? (
          <button className="inline-flex h-7 items-center rounded-md px-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Edit ${room.name}`}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-accent/10">
            <Plus className="h-3.5 w-3.5" />
            Room
          </button>
        )}
      </DialogTrigger>
      <DialogContent title={room ? `Edit ${room.name}` : "Add a room"}>
        <ActionForm
          action={room ? updateRoomAction : createRoomAction}
          hidden={room ? { roomId: room.id } : { floorId: floorId! }}
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          {(state) => (
            <>
              <Field label="Room name" name="name" required defaultValue={room?.name} placeholder="e.g. S12 Science lab" errors={state.fieldErrors?.name} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type" name="type" errors={state.fieldErrors?.type}>
                  <Select id="f-type" name="type" defaultValue={room?.type ?? "CLASSROOM"}>
                    {ROOM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ROOM_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Capacity"
                  name="capacity"
                  type="number"
                  min={0}
                  defaultValue={room?.capacity ?? ""}
                  hint="People normally in the room"
                  errors={state.fieldErrors?.capacity}
                />
              </div>
              <div className="flex justify-end">
                <SubmitButton>{room ? "Save room" : "Add room"}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
