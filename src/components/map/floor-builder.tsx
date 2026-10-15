"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpDown, Boxes, Cable, DoorOpen, Footprints, Minus, Move, Plus, Ruler, Server, ShoppingCart, Wifi, ZoomIn, ZoomOut, Maximize2, MousePointerClick } from "lucide-react";
import { createRoomOnMapAction, updateRoomGeometryAction } from "@/actions/map";
import { createCableRunAction, updateCableRunPointsAction } from "@/actions/cabling";
import { updateAssetPositionAction } from "@/actions/assets";
import { deleteRoomAction, updateRoomAction } from "@/actions/structure";
import { ActionForm, DeleteButton } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/button";
import { Field, FormError, Select } from "@/components/ui/field";
import { useActionFeedback } from "@/components/ui/use-action-feedback";
import { safeAction } from "@/components/ui/safe-action";
import { AddAssetButton, EditAssetButton, type AssetValues, type CabinetOption, type RoomOption, type SchoolOption } from "@/components/assets/asset-form";
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS, ROOM_TYPE_LABELS } from "@/lib/labels";
import { ROOM_TYPES } from "@/lib/validation";
import { pathLengthMetres, type CablePoint } from "@/lib/cabling";
import { cn } from "@/lib/utils";
import { CABLE_Z, SLAB, fitViewBox, groundBounds, overlaps, paintOrder, ROOM_COLOURS, snap, UNIT, unproject, type Rect } from "./iso";
import { AP_TOP_Z, CABINET_TOP_Z, IsoAccessPoint, IsoCabinet, IsoCable, IsoCoverage, IsoGround, IsoRoom, IsoTrolley, MarkerLabel, TROLLEY_TOP_Z, type DragMode, type SceneRoom } from "./iso-scene";
import { floorMarkers } from "./markers";
import { AccessPointPanel, CabinetPanel, TrolleyPanel } from "./marker-panels";
import { CableLegend, CableListPanel, CableRunPanel, DrawingPanel, type BuilderCable } from "./cable-panels";

export type BuilderRoom = SceneRoom & { capacity: number | null; assets: AssetValues[] };
export type { BuilderCable };

type Props = {
  schoolId: string;
  floor: { id: string; name: string; planWidth: number };
  rooms: BuilderRoom[];
  cables: BuilderCable[];
  canEdit: boolean;
  canEditCables: boolean;
  canEditAssets: boolean;
  canDeleteAssets: boolean;
  initialRoomId: string | null;
  initialMode?: Mode;
  assetOptions: { schools: SchoolOption[]; rooms: RoomOption[]; cabinets: CabinetOption[] };
};

type Mode = "rooms" | "cabling";

type Drag = {
  roomId: string;
  mode: DragMode;
  startX: number;
  startY: number;
  orig: Rect;
  moved: boolean;
};

type VertexDrag = { cableId: string; index: number; orig: CablePoint[]; moved: boolean };
type MarkerKind = "ap" | "cabinet" | "trolley";
type MarkerDrag = { kind: MarkerKind; id: string; startX: number; startY: number; z: number; orig: CablePoint; moved: boolean };
type Layers = { devices: boolean; wifi: boolean; coverage: boolean; cabinets: boolean; trolleys: boolean; cables: boolean };
const DEFAULT_LAYERS: Layers = { devices: true, wifi: true, coverage: true, cabinets: true, trolleys: true, cables: true };
const LAYERS_KEY = "sv-map-layers";
type Drawing = { points: CablePoint[]; finished: boolean };

const PRESETS = [
  { label: "Small", w: 4, d: 4 },
  { label: "Classroom", w: 8, d: 7 },
  { label: "Large", w: 12, d: 9 },
  { label: "Hall", w: 20, d: 14 },
];

const MIN = 2 * UNIT;
const CABLE_SNAP = UNIT / 2; // cable points snap to 0.5 m
const safeCreateRoom = safeAction(createRoomOnMapAction);
const safeSaveGeometry = safeAction(updateRoomGeometryAction);
const safeCreateCable = safeAction(createCableRunAction);
const safeSaveCablePoints = safeAction(updateCableRunPointsAction);
const safeSavePosition = safeAction(updateAssetPositionAction);

/** Name of the (smallest) room containing a point, if any. */
function roomAt(rooms: (Rect & { name: string })[], p: CablePoint): string | null {
  const hits = rooms
    .filter((r) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return hits[0]?.name ?? null;
}

export function FloorBuilder({
  schoolId,
  floor,
  rooms: serverRooms,
  cables: serverCables,
  canEdit,
  canEditCables,
  canEditAssets,
  canDeleteAssets,
  initialRoomId,
  initialMode = "rooms",
  assetOptions,
}: Props) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [rooms, setRooms] = useState(serverRooms);
  const [cables, setCables] = useState(serverCables);
  const [selectedId, setSelectedId] = useState<string | null>(initialRoomId);
  const [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [vertexDrag, setVertexDrag] = useState<VertexDrag | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [cursor, setCursor] = useState<CablePoint | null>(null);
  const [savingRun, setSavingRun] = useState(false);
  const [runError, setRunError] = useState<string | undefined>();
  const [lastType, setLastType] = useState("CAT6");
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [selectedMarker, setSelectedMarker] = useState<{ kind: MarkerKind; id: string } | null>(null);
  const [markerDrag, setMarkerDrag] = useState<MarkerDrag | null>(null);
  const [markerOverride, setMarkerOverride] = useState<Record<string, CablePoint>>({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Remember which map layers this person likes to see.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAYERS_KEY);
      if (saved) setLayers({ ...DEFAULT_LAYERS, ...(JSON.parse(saved) as Partial<Layers>) });
    } catch {
      /* storage unavailable: keep defaults */
    }
  }, []);
  function toggleLayer(key: keyof Layers) {
    setLayers((current) => {
      const next = { ...current, [key]: !current[key] };
      try {
        window.localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Take fresh server data whenever it changes (after saves), unless mid-drag.
  useEffect(() => {
    if (!markerDrag) setMarkerOverride({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRooms]);
  useEffect(() => {
    if (!drag) setRooms(serverRooms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRooms]);
  useEffect(() => {
    if (!vertexDrag) setCables(serverCables);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCables]);

  const selected = mode === "rooms" ? (rooms.find((r) => r.id === selectedId) ?? null) : null;
  const selectedCable = mode === "cabling" ? (cables.find((c) => c.id === selectedCableId) ?? null) : null;

  // The viewBox follows committed geometry, not the live drag, so the view doesn't jump.
  const ground = useMemo(
    () =>
      groundBounds([
        ...serverRooms,
        // Cable points outside every room still need ground under them.
        ...serverCables.flatMap((c) => c.points.map((p) => ({ x: p.x, y: p.y, width: 1, height: 1 }))),
      ]),
    [serverRooms, serverCables],
  );
  const base = useMemo(() => fitViewBox(ground), [ground]);
  const vb = useMemo(() => {
    const w = base.width / zoom;
    const h = base.height / zoom;
    return { x: base.x + (base.width - w) / 2 + pan.x, y: base.y + (base.height - h) / 2 + pan.y, width: w, height: h };
  }, [base, zoom, pan]);

  const ordered = useMemo(() => paintOrder(rooms), [rooms]);
  const overlapping = useMemo(() => {
    const ids = new Set<string>();
    for (const a of rooms) for (const b of rooms) if (a.id !== b.id && overlaps(a, b)) ids.add(a.id);
    return ids;
  }, [rooms]);

  const markers = useMemo(() => {
    const m = floorMarkers(rooms);
    return {
      ...m,
      accessPoints: m.accessPoints.map((a) => ({ ...a, ...(markerOverride[a.id] ?? {}) })),
      cabinets: m.cabinets.map((c) => ({ ...c, ...(markerOverride[c.id] ?? {}) })),
      trolleys: m.trolleys.map((t) => ({ ...t, ...(markerOverride[t.id] ?? {}) })),
    };
  }, [rooms, markerOverride]);
  const allAssets = useMemo(() => rooms.flatMap((r) => r.assets.map((a) => ({ ...a, roomName: r.name }))), [rooms]);
  const markerAsset = selectedMarker && mode === "rooms" ? (allAssets.find((a) => a.id === selectedMarker.id) ?? null) : null;

  // Keyboard shortcuts while drawing a cable.
  useEffect(() => {
    if (!drawing || drawing.finished) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (e.key === "Escape") setDrawing(null);
      if (e.key === "Enter" && drawing.points.length >= 2) setDrawing({ ...drawing, finished: true });
      if (e.key === "Backspace") {
        e.preventDefault();
        setDrawing({ ...drawing, points: drawing.points.slice(0, -1) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawing]);

  function switchMode(next: Mode) {
    setMode(next);
    setSelectedId(null);
    setSelectedCableId(null);
    setSelectedMarker(null);
    setDrawing(null);
    setCursor(null);
  }

  /** Pointer position in SVG user units. */
  function toSvg(e: { clientX: number; clientY: number }) {
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  /** Pointer position on the cable plane, snapped to 0.5 m. */
  function cablePoint(e: { clientX: number; clientY: number }): CablePoint {
    const p = toSvg(e);
    const w = unproject(p.x, p.y, CABLE_Z);
    return { x: snap(w.x, CABLE_SNAP), y: snap(w.y, CABLE_SNAP) };
  }

  // ─── Rooms ────────────────────────────────────────────────────────────

  function onRoomPointerDown(e: React.PointerEvent, roomId: string, dragMode: DragMode) {
    e.stopPropagation();
    setSelectedId(roomId);
    setSelectedMarker(null);
    if (!canEdit) return;
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    const p = toSvg(e);
    svgRef.current?.setPointerCapture(e.pointerId);
    setDrag({ roomId, mode: dragMode, startX: p.x, startY: p.y, orig: { x: room.x, y: room.y, width: room.width, height: room.height }, moved: false });
  }

  function onDevicePointerDown(e: React.PointerEvent, _deviceId: string, roomId: string) {
    e.stopPropagation();
    setSelectedId(roomId);
  }

  async function saveGeometry(roomId: string, next: Rect, previous: Rect) {
    setRooms((rs) => rs.map((r) => (r.id === roomId ? { ...r, ...next } : r)));
    const result = await safeSaveGeometry({ roomId, ...next });
    if (result.error) {
      toast.error(result.error);
      setRooms((rs) => rs.map((r) => (r.id === roomId ? { ...r, ...previous } : r)));
    } else {
      router.refresh();
    }
  }

  function resizeBy(dimension: "width" | "height", metres: number) {
    if (!selected) return;
    const previous = { x: selected.x, y: selected.y, width: selected.width, height: selected.height };
    const value = Math.max(MIN, Math.min(200 * UNIT, snap(selected[dimension]) + metres * UNIT));
    void saveGeometry(selected.id, { ...previous, [dimension]: value }, previous);
  }

  // ─── Access points and cabinets ───────────────────────────────────────

  function onMarkerPointerDown(kind: MarkerKind) {
    return (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      setSelectedMarker({ kind, id });
      setSelectedId(null);
      if (!canEditAssets) return;
      const marker =
        kind === "ap"
          ? markers.accessPoints.find((a) => a.id === id)
          : kind === "trolley"
            ? markers.trolleys.find((t) => t.id === id)
            : markers.cabinets.find((c) => c.id === id);
      if (!marker) return;
      const p = toSvg(e);
      svgRef.current?.setPointerCapture(e.pointerId);
      setMarkerDrag({ kind, id, startX: p.x, startY: p.y, z: kind === "ap" ? AP_TOP_Z : SLAB, orig: { x: marker.x, y: marker.y }, moved: false });
    };
  }

  async function saveMarker(id: string, position: CablePoint) {
    const result = await safeSavePosition({ assetId: id, floorId: floor.id, mapX: position.x, mapY: position.y });
    if (result.error) {
      toast.error(result.error);
      setMarkerOverride((o) => {
        const next = { ...o };
        delete next[id];
        return next;
      });
    } else {
      router.refresh();
    }
  }

  // ─── Cables ───────────────────────────────────────────────────────────

  function onCablePointerDown(e: React.PointerEvent, cableId: string) {
    if (drawing) return; // clicks while drawing add points instead
    e.stopPropagation();
    setSelectedCableId(cableId);
  }

  function onVertexPointerDown(e: React.PointerEvent, cableId: string, index: number) {
    e.stopPropagation();
    if (!canEditCables) return;
    const cable = cables.find((c) => c.id === cableId);
    if (!cable) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    setVertexDrag({ cableId, index, orig: cable.points, moved: false });
  }

  async function saveCablePoints(cableId: string, points: CablePoint[], previous: CablePoint[]) {
    const result = await safeSaveCablePoints({ cableRunId: cableId, points });
    if (result.error) {
      toast.error(result.error);
      setCables((cs) => cs.map((c) => (c.id === cableId ? { ...c, points: previous, lengthMetres: pathLengthMetres(previous) } : c)));
    } else {
      router.refresh();
    }
  }

  async function saveNewRun(values: { name: string; type: string; notes: string }) {
    if (!drawing) return;
    setSavingRun(true);
    setRunError(undefined);
    const result = await safeCreateCable({ floorId: floor.id, ...values, points: drawing.points });
    setSavingRun(false);
    if (result.ok) {
      toast.success(result.message ?? "Cable run saved.");
      setLastType(values.type);
      setDrawing(null);
      setCursor(null);
      if (result.data?.cableRunId) setSelectedCableId(result.data.cableRunId);
      router.refresh();
    } else {
      setRunError(result.fieldErrors ? Object.values(result.fieldErrors).flat()[0] : result.error);
    }
  }

  // ─── Pointer plumbing ────────────────────────────────────────────────

  function onPointerMove(e: React.PointerEvent) {
    if (panStart.current) {
      const svg = svgRef.current!;
      const scale = vb.width / svg.clientWidth;
      setPan({ x: panStart.current.x - (e.clientX - panStart.current.px) * scale, y: panStart.current.y - (e.clientY - panStart.current.py) * scale });
      return;
    }
    if (drawing && !drawing.finished) {
      setCursor(cablePoint(e));
      return;
    }
    if (markerDrag) {
      const p = toSvg(e);
      const a = unproject(markerDrag.startX, markerDrag.startY, markerDrag.z);
      const b = unproject(p.x, p.y, markerDrag.z);
      const next = { x: snap(markerDrag.orig.x + b.x - a.x, UNIT / 4), y: snap(markerDrag.orig.y + b.y - a.y, UNIT / 4) };
      setMarkerOverride((o) => ({ ...o, [markerDrag.id]: next }));
      if (!markerDrag.moved && (next.x !== markerDrag.orig.x || next.y !== markerDrag.orig.y)) setMarkerDrag({ ...markerDrag, moved: true });
      return;
    }
    if (vertexDrag) {
      const p = cablePoint(e);
      setCables((cs) =>
        cs.map((c) => {
          if (c.id !== vertexDrag.cableId) return c;
          const points = c.points.map((q, i) => (i === vertexDrag.index ? p : q));
          return { ...c, points, lengthMetres: pathLengthMetres(points) };
        }),
      );
      const o = vertexDrag.orig[vertexDrag.index]!;
      if (!vertexDrag.moved && (o.x !== p.x || o.y !== p.y)) setVertexDrag({ ...vertexDrag, moved: true });
      return;
    }
    if (!drag) return;
    const p = toSvg(e);
    const start = unproject(drag.startX, drag.startY);
    const now = unproject(p.x, p.y);
    const dx = now.x - start.x;
    const dy = now.y - start.y;
    const o = drag.orig;
    let next: Rect = o;
    if (drag.mode === "move") next = { ...o, x: snap(o.x + dx), y: snap(o.y + dy) };
    if (drag.mode === "width") next = { ...o, width: Math.max(MIN, snap(o.width + dx)) };
    if (drag.mode === "depth") next = { ...o, height: Math.max(MIN, snap(o.height + dy)) };
    if (drag.mode === "both") next = { ...o, width: Math.max(MIN, snap(o.width + dx)), height: Math.max(MIN, snap(o.height + dy)) };
    const changed = next.x !== o.x || next.y !== o.y || next.width !== o.width || next.height !== o.height;
    setRooms((rs) => rs.map((r) => (r.id === drag.roomId ? { ...r, ...next } : r)));
    if (changed && !drag.moved) setDrag({ ...drag, moved: true });
  }

  async function onPointerUp() {
    panStart.current = null;
    if (markerDrag) {
      const current = markerDrag;
      setMarkerDrag(null);
      const position = markerOverride[current.id];
      if (current.moved && position) await saveMarker(current.id, position);
      return;
    }
    if (vertexDrag) {
      const current = vertexDrag;
      setVertexDrag(null);
      if (!current.moved) return;
      const cable = cables.find((c) => c.id === current.cableId);
      if (cable) await saveCablePoints(cable.id, cable.points, current.orig);
      return;
    }
    if (!drag) return;
    const current = drag;
    setDrag(null);
    if (!current.moved) return;
    const room = rooms.find((r) => r.id === current.roomId);
    if (!room) return;
    await saveGeometry(room.id, { x: room.x, y: room.y, width: room.width, height: room.height }, current.orig);
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    if (mode === "cabling" && drawing && !drawing.finished) {
      const p = cablePoint(e);
      const last = drawing.points[drawing.points.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) setDrawing({ ...drawing, points: [...drawing.points, p] });
      return;
    }
    setSelectedId(null);
    setSelectedCableId(null);
    setSelectedMarker(null);
    if (zoom > 1) {
      panStart.current = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  }

  const zoomTo = (z: number) => {
    setZoom(Math.min(4, Math.max(1, z)));
    if (z <= 1) setPan({ x: 0, y: 0 });
  };

  const draftCable =
    drawing && drawing.points.length > 0
      ? {
          id: "__draft",
          name: "New cable run",
          type: lastType,
          points: !drawing.finished && cursor ? [...drawing.points, cursor] : drawing.points,
          lengthMetres: pathLengthMetres(!drawing.finished && cursor ? [...drawing.points, cursor] : drawing.points),
        }
      : null;

  const roomsInteractive = mode === "rooms";
  const hint =
    mode === "cabling"
      ? drawing && !drawing.finished
        ? ["Click to add points along the route", "Double-click or press Finish to end"]
        : canEditCables
          ? ["Click a cable to select it", "Drag its points to reroute"]
          : ["Click a cable to see its details"]
      : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-bg shadow-card">
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
          className={cn(
            "block h-[min(70vh,640px)] w-full select-none",
            (canEdit || canEditCables) && "touch-none",
            drag && "cursor-grabbing",
            drawing && !drawing.finished && "cursor-crosshair",
          )}
          role="img"
          aria-label={`3D floor plan of ${floor.name}`}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerDown={onBackgroundPointerDown}
          onDoubleClick={() => {
            if (drawing && !drawing.finished && drawing.points.length >= 2) setDrawing({ ...drawing, finished: true });
          }}
          onPointerLeave={() => setCursor(null)}
        >
          <IsoGround ground={ground} />
          {ordered.map((room) => (
            <IsoRoom
              key={`body-${room.id}`}
              layer="body"
              room={{ ...room, devices: markers.devicesByRoom.get(room.id) ?? [] }}
              showDevices={layers.devices}
              selected={room.id === selectedId}
              overlapping={overlapping.has(room.id)}
              interactive={roomsInteractive && canEdit}
              handlers={roomsInteractive ? { onRoomPointerDown, onDevicePointerDown } : undefined}
            />
          ))}
          {layers.wifi && layers.coverage ? markers.accessPoints.map((ap) => <IsoCoverage key={`cov-${ap.id}`} ap={ap} />) : null}
          {layers.cabinets
            ? [...markers.cabinets]
                .sort((a, b) => a.x + a.y - (b.x + b.y))
                .map((cab) => (
                  <IsoCabinet
                    key={cab.id}
                    cabinet={cab}
                    selected={selectedMarker?.id === cab.id}
                    onPointerDown={roomsInteractive ? onMarkerPointerDown("cabinet") : undefined}
                  />
                ))
            : null}
          {layers.trolleys
            ? [...markers.trolleys]
                .sort((a, b) => a.x + a.y - (b.x + b.y))
                .map((t) => (
                  <IsoTrolley
                    key={t.id}
                    trolley={t}
                    selected={selectedMarker?.id === t.id}
                    onPointerDown={roomsInteractive ? onMarkerPointerDown("trolley") : undefined}
                  />
                ))
            : null}
          {layers.cables || mode === "cabling"
            ? cables.map((c) => (
                <IsoCable
                  key={c.id}
                  cable={c}
                  selected={c.id === selectedCableId && mode === "cabling"}
                  dimmed={mode === "rooms" || (Boolean(selectedCableId) && c.id !== selectedCableId)}
                  onPointerDown={mode === "cabling" ? onCablePointerDown : undefined}
                  onVertexPointerDown={mode === "cabling" && canEditCables ? onVertexPointerDown : undefined}
                />
              ))
            : null}
          {draftCable ? <IsoCable cable={draftCable} selected /> : null}
          {ordered.map((room) => (
            <IsoRoom
              key={`label-${room.id}`}
              layer="label"
              room={{ ...room, devices: markers.devicesByRoom.get(room.id) ?? [] }}
              showDevices={layers.devices}
              selected={room.id === selectedId}
              overlapping={false}
              interactive={false}
            />
          ))}
          {layers.wifi
            ? markers.accessPoints.map((ap) => (
                <IsoAccessPoint
                  key={ap.id}
                  ap={ap}
                  selected={selectedMarker?.id === ap.id}
                  onPointerDown={roomsInteractive ? onMarkerPointerDown("ap") : undefined}
                />
              ))
            : null}
          {roomsInteractive
            ? ordered.map((room) => (
                <IsoRoom
                  key={`handles-${room.id}`}
                  layer="handles"
                  room={room}
                  selected={room.id === selectedId}
                  overlapping={false}
                  interactive={canEdit}
                  handlers={{ onRoomPointerDown, onDevicePointerDown }}
                />
              ))
            : null}
          {selectedMarker && mode === "rooms"
            ? (() => {
                const m =
                  selectedMarker.kind === "ap"
                    ? markers.accessPoints.find((a) => a.id === selectedMarker.id)
                    : selectedMarker.kind === "trolley"
                      ? markers.trolleys.find((t) => t.id === selectedMarker.id)
                      : markers.cabinets.find((c) => c.id === selectedMarker.id);
                if (!m) return null;
                const text =
                  "usedUnits" in m
                    ? selectedMarker.kind === "trolley"
                      ? `${m.name}, ${m.usedUnits}/${m.rackUnits} bays`
                      : `${m.name}, ${m.usedUnits}/${m.rackUnits}U`
                    : m.name;
                const z = selectedMarker.kind === "ap" ? AP_TOP_Z : selectedMarker.kind === "trolley" ? TROLLEY_TOP_Z : CABINET_TOP_Z;
                return <MarkerLabel x={m.x} y={m.y} z={z} text={text} />;
              })()
            : null}
        </svg>

        {/* Mode switch */}
        <div className="absolute left-3 top-3 flex overflow-hidden rounded-xl border border-line bg-surface/90 p-1 text-sm backdrop-blur" role="tablist" aria-label="Plan mode">
          {(
            [
              ["rooms", "Rooms & equipment", Boxes],
              ["cabling", "Cabling", Cable],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => switchMode(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors",
                mode === value ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Layer toggles */}
        <div className="absolute left-3 top-[3.6rem] flex max-w-[calc(100%-5rem)] flex-wrap gap-1.5" aria-label="Show on plan">
          {(
            [
              ["devices", "Devices", Boxes],
              ["wifi", "Wi-Fi", Wifi],
              ["coverage", "Coverage", Wifi],
              ["cabinets", "Cabinets", Server],
              ["trolleys", "Trolleys", ShoppingCart],
              ["cables", "Cables", Cable],
            ] as const
          )
            .filter(([key]) => key !== "coverage" || layers.wifi)
            .map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                aria-pressed={layers[key]}
                onClick={() => toggleLayer(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium backdrop-blur transition-colors",
                  layers[key] ? "border-accent/40 bg-surface/90 text-fg" : "border-line bg-surface/60 text-muted line-through decoration-muted/50",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", layers[key] ? "text-accent" : "")} />
                {label}
              </button>
            ))}
        </div>

        <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl border border-line bg-surface/90 backdrop-blur">
          <button className="p-2 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => zoomTo(zoom * 1.4)} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button className="border-t border-line p-2 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => zoomTo(zoom / 1.4)} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button className="border-t border-line p-2 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => zoomTo(1)} aria-label="Fit to screen">
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {hint ? (
            hint.map((h) => <span key={h}>{h}</span>)
          ) : canEdit ? (
            <>
              <span className="flex items-center gap-1.5"><MousePointerClick className="h-3.5 w-3.5" />Click a room to select it</span>
              <span className="flex items-center gap-1.5"><Move className="h-3.5 w-3.5" />Drag the floor to move it</span>
              <span className="flex items-center gap-1.5"><Ruler className="h-3.5 w-3.5" />Drag the dots to resize</span>
            </>
          ) : (
            <span>Click a room to see its equipment.</span>
          )}
          {mode === "rooms" && overlapping.size > 0 ? <span className="font-medium text-danger">Red outlines mean rooms overlap.</span> : null}
        </div>
      </div>

      <aside className="space-y-4">
        {mode === "cabling" ? (
          <>
            {drawing ? (
              <DrawingPanel
                key={drawing.finished ? "save" : "draw"}
                points={drawing.points}
                finished={drawing.finished}
                saving={savingRun}
                error={runError}
                defaultType={lastType}
                onUndo={() => setDrawing({ ...drawing, points: drawing.points.slice(0, -1) })}
                onFinish={() => setDrawing({ ...drawing, finished: true })}
                onCancel={() => {
                  setDrawing(null);
                  setRunError(undefined);
                }}
                onSave={saveNewRun}
              />
            ) : selectedCable ? (
              <CableRunPanel
                key={selectedCable.id}
                cable={selectedCable}
                fromRoom={roomAt(rooms, selectedCable.points[0]!)}
                toRoom={roomAt(rooms, selectedCable.points[selectedCable.points.length - 1]!)}
                canEdit={canEditCables}
                onClose={() => setSelectedCableId(null)}
              />
            ) : (
              <CableListPanel
                cables={cables}
                canEdit={canEditCables}
                onStart={() => {
                  setSelectedCableId(null);
                  setDrawing({ points: [], finished: false });
                }}
                onSelect={setSelectedCableId}
              />
            )}
            <CableLegend />
          </>
        ) : (
          <>
            {markerAsset && selectedMarker?.kind === "ap" ? (
              <AccessPointPanel
                key={markerAsset.id}
                ap={markerAsset}
                roomName={markerAsset.roomName}
                canEdit={canEditAssets}
                canDelete={canDeleteAssets}
                options={assetOptions}
                onClose={() => setSelectedMarker(null)}
              />
            ) : markerAsset && selectedMarker?.kind === "trolley" ? (
              <TrolleyPanel
                key={markerAsset.id}
                trolley={markerAsset}
                contents={allAssets.filter((a) => a.cabinetId === markerAsset.id)}
                roomName={markerAsset.roomName}
                schoolId={schoolId}
                canEdit={canEditAssets}
                canDelete={canDeleteAssets}
                options={assetOptions}
                onClose={() => setSelectedMarker(null)}
              />
            ) : markerAsset && selectedMarker?.kind === "cabinet" ? (
              <CabinetPanel
                key={markerAsset.id}
                cabinet={markerAsset}
                contents={allAssets.filter((a) => a.cabinetId === markerAsset.id)}
                roomName={markerAsset.roomName}
                schoolId={schoolId}
                canEdit={canEditAssets}
                canDelete={canDeleteAssets}
                options={assetOptions}
                onClose={() => setSelectedMarker(null)}
              />
            ) : selected ? (
              <RoomPanel
                key={selected.id}
                room={selected}
                schoolId={schoolId}
                canEdit={canEdit}
                canEditAssets={canEditAssets}
                canDeleteAssets={canDeleteAssets}
                assetOptions={assetOptions}
                onResize={resizeBy}
                onClose={() => setSelectedId(null)}
                onSelectMarker={(kind, id) => {
                  setSelectedMarker({ kind, id });
                  setSelectedId(null);
                }}
              />
            ) : canEdit || canEditAssets || canEditCables ? (
              <AddToFloorPanel
                floorId={floor.id}
                schoolId={schoolId}
                canEdit={canEdit}
                canEditAssets={canEditAssets}
                canEditCables={canEditCables}
                assetOptions={assetOptions}
                onCreated={(id) => setSelectedId(id)}
                onStartCable={() => {
                  switchMode("cabling");
                  setDrawing({ points: [], finished: false });
                }}
              />
            ) : (
              <div className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">Select a room on the plan to see what&apos;s in it.</div>
            )}
            <Legend />
          </>
        )}
      </aside>
    </div>
  );
}

type AddKind = "ROOM" | "STAIRS" | "LIFT";

const ADD_DEFAULTS: Record<AddKind, { name: string; w: number; d: number; presets: { label: string; w: number; d: number }[] }> = {
  ROOM: { name: "", w: 8, d: 7, presets: PRESETS },
  STAIRS: { name: "Stairs", w: 3, d: 6, presets: [{ label: "Narrow", w: 2, d: 5 }, { label: "Standard", w: 3, d: 6 }, { label: "Wide", w: 4, d: 7 }, { label: "Double", w: 6, d: 7 }] },
  LIFT: { name: "Lift", w: 2, d: 2, presets: [{ label: "Small", w: 2, d: 2 }, { label: "Standard", w: 3, d: 3 }, { label: "Goods", w: 3, d: 4 }, { label: "Large", w: 4, d: 4 }] },
};

/**
 * The default side panel: one place to add anything to this floor.
 */
function AddToFloorPanel({
  floorId,
  schoolId,
  canEdit,
  canEditAssets,
  canEditCables,
  assetOptions,
  onCreated,
  onStartCable,
}: {
  floorId: string;
  schoolId: string;
  canEdit: boolean;
  canEditAssets: boolean;
  canEditCables: boolean;
  assetOptions: { schools: SchoolOption[]; rooms: RoomOption[]; cabinets: CabinetOption[] };
  onCreated: (roomId: string) => void;
  onStartCable: () => void;
}) {
  const [kind, setKind] = useState<AddKind | null>(null);
  const tile =
    "flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors";
  const idle = "border-line bg-bg/40 hover:border-accent/50 hover:bg-accent/5";
  const active = "border-accent bg-accent/10 text-accent";

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-[15px] font-semibold">Add to this floor</h2>
      <p className="mt-0.5 text-[13px] text-muted">Or click anything on the plan to see and edit it.</p>

      {canEdit ? (
        <>
          <p className="mb-1.5 mt-4 text-xs font-medium text-muted">Spaces</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["ROOM", "Room", DoorOpen],
                ["STAIRS", "Stairs", Footprints],
                ["LIFT", "Lift", ArrowUpDown],
              ] as const
            ).map(([value, label, Icon]) => (
              <button key={value} type="button" onClick={() => setKind(kind === value ? null : value)} className={cn(tile, kind === value ? active : idle)} aria-pressed={kind === value}>
                <Icon className="h-4 w-4 text-accent" />
                {label}
              </button>
            ))}
          </div>
          {kind ? <AddSpaceForm key={kind} kind={kind} floorId={floorId} onCreated={(id) => { setKind(null); onCreated(id); }} /> : null}
        </>
      ) : null}

      {canEditAssets ? (
        <>
          <p className="mb-1.5 mt-5 text-xs font-medium text-muted">Equipment</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["ACCESS_POINT", "Access point", Wifi],
                ["CABINET", "Server cabinet", Server],
                ["TROLLEY", "Trolley", ShoppingCart],
                ["DESKTOP", "Other device", Boxes],
              ] as const
            ).map(([type, label]) => (
              <AddAssetButton
                key={type}
                variant="secondary"
                className="w-full justify-start"
                label={label}
                schools={assetOptions.schools}
                rooms={assetOptions.rooms}
                cabinets={assetOptions.cabinets}
                defaults={{ schoolId, type }}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">Pick the room it's in when you add it. Tip: select a room first and its panel adds straight into it.</p>
        </>
      ) : null}

      {canEditCables ? (
        <>
          <p className="mb-1.5 mt-5 text-xs font-medium text-muted">Cabling</p>
          <button type="button" onClick={onStartCable} className={cn(tile, idle, "flex-row items-center gap-2")}>
            <Cable className="h-4 w-4 text-accent" />
            Draw a cable run
          </button>
        </>
      ) : null}
    </div>
  );
}

function AddSpaceForm({ kind, floorId, onCreated }: { kind: AddKind; floorId: string; onCreated: (roomId: string) => void }) {
  const defaults = ADD_DEFAULTS[kind];
  const [state, action] = useActionState(safeCreateRoom, {});
  const [size, setSize] = useState({ w: defaults.w, d: defaults.d });
  const formRef = useRef<HTMLFormElement>(null);
  useActionFeedback(state, () => {
    formRef.current?.reset();
    if (state.data?.roomId) onCreated(state.data.roomId);
  });

  return (
    <form ref={formRef} action={action} className="mt-4 space-y-4 rounded-xl border border-line/70 bg-bg/40 p-3" noValidate>
      <input type="hidden" name="floorId" value={floorId} />
      <input type="hidden" name="widthM" value={size.w} />
      <input type="hidden" name="depthM" value={size.d} />
      {kind !== "ROOM" ? <input type="hidden" name="type" value={kind} /> : null}
      <FormError message={state.fieldErrors ? undefined : state.ok ? undefined : state.error} />
      <Field
        label="Name"
        name="name"
        defaultValue={defaults.name}
        placeholder={kind === "ROOM" ? "e.g. S12 Science lab" : undefined}
        hint={kind === "STAIRS" ? "e.g. Stairs A. Add a matching one on each floor it connects." : undefined}
        errors={state.fieldErrors?.name}
      />
      {kind === "ROOM" ? (
        <Field label="Type" name="type">
          <Select id="f-type" name="type" defaultValue="CLASSROOM">
            {ROOM_TYPES.filter((t) => t !== "STAIRS" && t !== "LIFT").map((t) => (
              <option key={t} value={t}>
                {ROOM_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div>
        <p className="mb-1.5 text-[13px] font-medium">Size</p>
        <div className="grid grid-cols-4 gap-1.5">
          {defaults.presets.map((p) => {
            const on = p.w === size.w && p.d === size.d;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => setSize({ w: p.w, d: p.d })}
                className={cn(
                  "rounded-lg border px-1 py-2 text-center text-xs transition-colors",
                  on ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:border-muted/50 hover:text-fg",
                )}
              >
                <span className="block font-medium">{p.label}</span>
                <span className="block text-[11px] opacity-80">
                  {p.w}×{p.d} m
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Stepper label="Width" value={size.w} onChange={(w) => setSize((s) => ({ ...s, w }))} />
          <Stepper label="Depth" value={size.d} onChange={(d) => setSize((s) => ({ ...s, d }))} />
        </div>
      </div>
      <SubmitButton className="w-full" pendingLabel="Adding…">
        <Plus className="h-4 w-4" />
        Add {kind === "ROOM" ? "room" : kind === "STAIRS" ? "stairs" : "lift"} to plan
      </SubmitButton>
    </form>
  );
}

function Stepper({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="flex h-10 items-center overflow-hidden rounded-lg border border-line bg-bg/60">
        <button
          type="button"
          disabled={disabled || value <= 2}
          onClick={() => onChange(Math.max(2, value - 1))}
          className="grid h-full w-10 place-items-center text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="flex-1 text-center text-sm font-semibold tabular-nums">{value} m</span>
        <button
          type="button"
          disabled={disabled || value >= 200}
          onClick={() => onChange(Math.min(200, value + 1))}
          className="grid h-full w-10 place-items-center text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function RoomPanel({
  room,
  schoolId,
  canEdit,
  canEditAssets,
  canDeleteAssets,
  assetOptions,
  onResize,
  onClose,
  onSelectMarker,
}: {
  room: BuilderRoom;
  schoolId: string;
  canEdit: boolean;
  canEditAssets: boolean;
  canDeleteAssets: boolean;
  assetOptions: { schools: SchoolOption[]; rooms: RoomOption[]; cabinets: CabinetOption[] };
  onResize: (dimension: "width" | "height", metres: number) => void;
  onClose: () => void;
  onSelectMarker: (kind: MarkerKind, id: string) => void;
}) {
  const widthM = Math.round(room.width / UNIT);
  const depthM = Math.round(room.height / UNIT);
  const colour = ROOM_COLOURS[room.type] ?? ROOM_COLOURS.OTHER;

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-line/70 p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colour }} />
            {ROOM_TYPE_LABELS[room.type]}
            {room.capacity ? `, seats ${room.capacity}` : ""}
          </p>
          <h2 className="mt-1 truncate font-display text-lg font-semibold">{room.name}</h2>
        </div>
        <button onClick={onClose} className="text-xs text-muted hover:text-fg">
          Done
        </button>
      </div>

      {canEdit ? (
        <div className="space-y-4 border-b border-line/70 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Stepper label="Width" value={widthM} onChange={(v) => onResize("width", v - widthM)} />
            <Stepper label="Depth" value={depthM} onChange={(v) => onResize("height", v - depthM)} />
          </div>
          <ActionForm action={updateRoomAction} hidden={{ roomId: room.id }} className="space-y-3">
            {(state) => (
              <>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                  <Field label="Name" name="name" id={`n-${room.id}`} defaultValue={room.name} errors={state.fieldErrors?.name} />
                  <Field label="Type" name="type" id={`t-${room.id}`}>
                    <Select id={`t-${room.id}`} name="type" defaultValue={room.type}>
                      {ROOM_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ROOM_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <input type="hidden" name="capacity" value={room.capacity ?? ""} />
                <div className="flex justify-end">
                  <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                    Save name and type
                  </SubmitButton>
                </div>
              </>
            )}
          </ActionForm>
          {/* Kept outside the form above: forms can't be nested. */}
          <div className="flex items-center justify-between border-t border-line/60 pt-3 text-xs text-muted">
            <span>Delete this room (its equipment stays, unassigned)</span>
            <DeleteButton action={deleteRoomAction} hidden={{ roomId: room.id }} label={`Delete ${room.name}`} />
          </div>
        </div>
      ) : null}

      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">
            Equipment <span className="font-normal text-muted">({room.assets.length})</span>
          </h3>
          {canEditAssets ? (
            <AddAssetButton
              size="sm"
              label="Add here"
              schools={assetOptions.schools}
              rooms={assetOptions.rooms}
              cabinets={assetOptions.cabinets}
              defaults={{ schoolId, roomId: room.id }}
            />
          ) : null}
        </div>
        {canEditAssets ? (
          <div className="mb-3 grid grid-cols-3 gap-2">
            <AddAssetButton
              size="sm"
              variant="secondary"
              label="Access point"
              schools={assetOptions.schools}
              rooms={assetOptions.rooms}
              cabinets={assetOptions.cabinets}
              defaults={{ schoolId, roomId: room.id, type: "ACCESS_POINT" }}
            />
            <AddAssetButton
              size="sm"
              variant="secondary"
              label="Cabinet"
              schools={assetOptions.schools}
              rooms={assetOptions.rooms}
              cabinets={assetOptions.cabinets}
              defaults={{ schoolId, roomId: room.id, type: "CABINET" }}
            />
            <AddAssetButton
              size="sm"
              variant="secondary"
              label="Trolley"
              schools={assetOptions.schools}
              rooms={assetOptions.rooms}
              cabinets={assetOptions.cabinets}
              defaults={{ schoolId, roomId: room.id, type: "TROLLEY" }}
            />
          </div>
        ) : null}
        {room.assets.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing recorded in this room yet.</p>
        ) : (
          <ul className="-my-1 max-h-[340px] divide-y divide-line/60 overflow-y-auto">
            {room.assets
              .filter((a) => !a.cabinetId)
              .map((a) => {
                const marker: MarkerKind | null =
                  a.type === "ACCESS_POINT" ? "ap" : a.type === "CABINET" ? "cabinet" : a.type === "TROLLEY" ? "trolley" : null;
                const inside = marker === "cabinet" || marker === "trolley" ? room.assets.filter((c) => c.cabinetId === a.id).length : 0;
                return (
                  <li key={a.id} className="flex items-center gap-3 py-2">
                    {marker ? (
                      <button
                        type="button"
                        onClick={() => onSelectMarker(marker, a.id)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2 text-accent hover:bg-accent/15"
                        title={marker === "ap" ? "Show this access point" : marker === "trolley" ? "Open the trolley" : "Open the cabinet"}
                      >
                        {marker === "ap" ? <Wifi className="h-3.5 w-3.5" /> : marker === "trolley" ? <ShoppingCart className="h-3.5 w-3.5" /> : <Server className="h-3.5 w-3.5" />}
                      </button>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{a.name}</p>
                      <p className="truncate text-xs text-muted">
                        {ASSET_TYPE_LABELS[a.type]}, <span className="font-mono">{a.assetTag}</span>
                        {marker === "cabinet" || marker === "trolley" ? `, ${inside} ${inside === 1 ? "item" : "items"} inside` : ""}
                        {a.status !== "ACTIVE" ? `, ${ASSET_STATUS_LABELS[a.status]?.toLowerCase()}` : ""}
                      </p>
                    </div>
                    {canEditAssets ? (
                      <EditAssetButton asset={a} schools={assetOptions.schools} rooms={assetOptions.rooms} cabinets={assetOptions.cabinets} canDelete={canDeleteAssets} />
                    ) : null}
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Legend() {
  const types = ["CLASSROOM", "OFFICE", "IT_SUITE", "SERVER_ROOM", "COMMS_CABINET", "HALL", "LIBRARY", "STAFFROOM", "CORRIDOR", "STAIRS", "LIFT"];
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted">
        {types.map((t) => (
          <li key={t} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ROOM_COLOURS[t] }} />
            {ROOM_TYPE_LABELS[t]}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-warning" />
          Device in repair
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-muted" />
          Device in storage
        </li>
      </ul>
    </div>
  );
}
