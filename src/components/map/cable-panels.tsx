"use client";

import { useState } from "react";
import { ArrowRight, Cable, Check, Plus, Undo2, X } from "lucide-react";
import { deleteCableRunAction, updateCableRunAction } from "@/actions/cabling";
import { ActionForm, DeleteButton } from "@/components/ui/action-form";
import { Button, SubmitButton } from "@/components/ui/button";
import { Field, FormError, Select, Textarea } from "@/components/ui/field";
import { CABLE_COLOURS, CABLE_LABELS, CABLE_SHORT_LABELS, CABLE_TYPES, isFibre, pathLengthMetres, type CablePoint } from "@/lib/cabling";
import { cn } from "@/lib/utils";
import type { SceneCable } from "./iso-scene";

export type BuilderCable = SceneCable & { notes: string | null };

function Swatch({ type, className }: { type: string; className?: string }) {
  return (
    <span
      className={cn("inline-block h-1 w-5 shrink-0 rounded-full", className)}
      style={{
        background: isFibre(type)
          ? `repeating-linear-gradient(90deg, ${CABLE_COLOURS[type]} 0 6px, transparent 6px 9px)`
          : CABLE_COLOURS[type],
      }}
    />
  );
}

/** Default view in cabling mode: what's on this floor, and a way to draw more. */
export function CableListPanel({
  cables,
  canEdit,
  onStart,
  onSelect,
}: {
  cables: BuilderCable[];
  canEdit: boolean;
  onStart: () => void;
  onSelect: (id: string) => void;
}) {
  const totals = new Map<string, number>();
  for (const c of cables) totals.set(c.type, (totals.get(c.type) ?? 0) + c.lengthMetres);

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="border-b border-line/70 p-5">
        <h2 className="font-display text-[15px] font-semibold">Cable runs on this floor</h2>
        <p className="mt-0.5 text-[13px] text-muted">Trace each Ethernet or fibre route through the building. Lengths are measured as you draw.</p>
        {canEdit ? (
          <Button className="mt-4 w-full" onClick={onStart}>
            <Plus className="h-4 w-4" />
            Draw a cable run
          </Button>
        ) : null}
      </div>
      {cables.length === 0 ? (
        <p className="p-5 text-[13px] text-muted">No cable runs mapped on this floor yet.</p>
      ) : (
        <>
          <ul className="max-h-[320px] divide-y divide-line/60 overflow-y-auto">
            {cables.map((c) => (
              <li key={c.id}>
                <button onClick={() => onSelect(c.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-2/60">
                  <Swatch type={c.type} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{c.name}</span>
                    <span className="block text-xs text-muted">{CABLE_SHORT_LABELS[c.type]}</span>
                  </span>
                  <span className="text-xs tabular-nums text-muted">{c.lengthMetres} m</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-line/70 px-5 py-3">
            <p className="mb-1.5 text-xs font-medium text-muted">Totals on this floor</p>
            <ul className="space-y-1 text-xs">
              {[...totals.entries()].map(([type, metres]) => (
                <li key={type} className="flex items-center gap-2">
                  <Swatch type={type} />
                  <span className="flex-1">{CABLE_LABELS[type]}</span>
                  <span className="tabular-nums">{Math.round(metres * 10) / 10} m</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

/** Shown while a run is being drawn, then turns into the save form. */
export function DrawingPanel({
  points,
  finished,
  saving,
  error,
  defaultType,
  onUndo,
  onFinish,
  onCancel,
  onSave,
}: {
  points: CablePoint[];
  finished: boolean;
  saving: boolean;
  error?: string;
  defaultType: string;
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onSave: (values: { name: string; type: string; notes: string }) => void;
}) {
  const [type, setType] = useState(defaultType);
  const length = pathLengthMetres(points);

  if (!finished) {
    return (
      <div className="rounded-2xl border border-accent/40 bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold">
          <Cable className="h-4 w-4 text-accent" />
          Drawing a cable run
        </h2>
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-[13px] text-muted">
          <li>Click where the cable starts, for example the comms cabinet.</li>
          <li>Click each corner it turns along the way.</li>
          <li>Click where it ends, then press Finish (or double-click).</li>
        </ol>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-bg/60 px-3 py-2 text-sm">
          <span className="text-muted">
            {points.length} {points.length === 1 ? "point" : "points"}
          </span>
          <span className="font-semibold tabular-nums">{length} m</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button variant="secondary" size="sm" onClick={onUndo} disabled={points.length === 0}>
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
          <Button size="sm" onClick={onFinish} disabled={points.length < 2}>
            <Check className="h-3.5 w-3.5" />
            Finish
          </Button>
        </div>
        <p className="mt-3 text-[11px] text-muted">Keyboard: Enter to finish, Backspace to undo, Esc to cancel.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-accent/40 bg-surface p-5 shadow-card">
      <h2 className="font-display text-[15px] font-semibold">Save this cable run</h2>
      <p className="mt-0.5 text-[13px] text-muted">
        {points.length} points, {length} m long.
      </p>
      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          onSave({ name: String(fd.get("name") ?? ""), type, notes: String(fd.get("notes") ?? "") });
        }}
      >
        <FormError message={error} />
        <Field label="Name" name="name" placeholder="e.g. Comms F1 to IT suite" autoFocus />
        <Field label="Cable type" name="type">
          <Select id="f-cable-type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
            {CABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {CABLE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" name="notes">
          <Textarea id="f-cable-notes" name="notes" rows={2} placeholder="Patch panel ports, cores, containment…" />
        </Field>
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Discard
          </Button>
          <Button type="submit" loading={saving}>
            Save cable run
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Details and editing for one selected run. */
export function CableRunPanel({
  cable,
  fromRoom,
  toRoom,
  canEdit,
  onClose,
}: {
  cable: BuilderCable;
  fromRoom: string | null;
  toRoom: string | null;
  canEdit: boolean;
  onClose: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-line/70 p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-muted">
            <Swatch type={cable.type} />
            {CABLE_LABELS[cable.type]}
          </p>
          <h2 className="mt-1 truncate font-display text-lg font-semibold">{cable.name}</h2>
        </div>
        <button onClick={onClose} className="text-xs text-muted hover:text-fg">
          Done
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-b border-line/70 p-5 text-sm">
        <div>
          <dt className="text-xs text-muted">Length</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums">{cable.lengthMetres} m</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Bends</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums">{Math.max(0, cable.points.length - 2)}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted">Route</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span>{fromRoom ?? "Outside a room"}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted" />
            <span>{toRoom ?? "Outside a room"}</span>
          </dd>
        </div>
        {cable.notes && !canEdit ? (
          <div className="col-span-2">
            <dt className="text-xs text-muted">Notes</dt>
            <dd className="mt-0.5 whitespace-pre-line">{cable.notes}</dd>
          </div>
        ) : null}
      </dl>

      {canEdit ? (
        <div className="space-y-4 p-5">
          <p className="text-[13px] text-muted">Drag the round points on the plan to reroute it.</p>
          <ActionForm action={updateCableRunAction} hidden={{ cableRunId: cable.id }} className="space-y-3">
            {(state) => (
              <>
                <Field label="Name" name="name" id={`cn-${cable.id}`} defaultValue={cable.name} errors={state.fieldErrors?.name} />
                <Field label="Cable type" name="type" id={`ct-${cable.id}`}>
                  <Select id={`ct-${cable.id}`} name="type" defaultValue={cable.type}>
                    {CABLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CABLE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Notes" name="notes" id={`cnotes-${cable.id}`}>
                  <Textarea id={`cnotes-${cable.id}`} name="notes" rows={2} defaultValue={cable.notes ?? ""} />
                </Field>
                <div className="flex justify-end">
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                    Save details
                  </SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
          <div className="flex items-center justify-between border-t border-line/60 pt-3 text-xs text-muted">
            <span>Delete this cable run</span>
            <DeleteButton action={deleteCableRunAction} hidden={{ cableRunId: cable.id }} label={`Delete ${cable.name}`} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function CableLegend() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted">
        {CABLE_TYPES.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <Swatch type={t} />
            {CABLE_SHORT_LABELS[t]}
          </li>
        ))}
      </ul>
    </div>
  );
}
