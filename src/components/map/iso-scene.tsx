// Pure SVG renderer for the isometric floor plan (no hooks), so it can be
// rendered on the server and driven by the interactive FloorBuilder.
import { CABLE_COLOURS, CABLE_SHORT_LABELS, isFibre } from "@/lib/cabling";
import { AP_COVERAGE_M, CABINET_D, CABINET_H, CABINET_W, CABLE_Z, COS, SIN, TROLLEY_D, TROLLEY_H, TROLLEY_W, deviceSlots, isCirculation, groundBounds, LIP, paintOrder, project, pts, ROOM_COLOURS, SLAB, UNIT, WALL, type Rect } from "./iso";

export type SceneDevice = { id: string; name: string; type: string; status: string };
export type SceneRoom = Rect & { id: string; name: string; type: string; devices: SceneDevice[] };
export type DragMode = "move" | "width" | "depth" | "both";
export type SceneCable = { id: string; name: string; type: string; points: { x: number; y: number }[]; lengthMetres: number };

type Handlers = {
  onRoomPointerDown?: (event: React.PointerEvent, roomId: string, mode: DragMode) => void;
  onDevicePointerDown?: (event: React.PointerEvent, deviceId: string, roomId: string) => void;
};

const DEVICE_COLOUR: Record<string, string> = {
  ACTIVE: "rgb(var(--fg) / 0.88)",
  IN_REPAIR: "#F2B544",
  IN_STORAGE: "#8A98AB",
  RETIRED: "#56637A",
};

export function IsoGround({ ground }: { ground: Rect }) {
  const { x, y, width, height } = ground;
  const lines: React.ReactNode[] = [];
  const startX = Math.ceil(x / UNIT) * UNIT;
  const startY = Math.ceil(y / UNIT) * UNIT;
  for (let gx = startX; gx <= x + width; gx += UNIT) {
    const major = Math.round(gx / UNIT) % 5 === 0;
    lines.push(
      <line
        key={`x${gx}`}
        x1={project(gx, y)[0]}
        y1={project(gx, y)[1]}
        x2={project(gx, y + height)[0]}
        y2={project(gx, y + height)[1]}
        stroke="rgb(var(--accent))"
        strokeOpacity={major ? 0.16 : 0.06}
        strokeWidth={major ? 0.8 : 0.5}
      />,
    );
  }
  for (let gy = startY; gy <= y + height; gy += UNIT) {
    const major = Math.round(gy / UNIT) % 5 === 0;
    lines.push(
      <line
        key={`y${gy}`}
        x1={project(x, gy)[0]}
        y1={project(x, gy)[1]}
        x2={project(x + width, gy)[0]}
        y2={project(x + width, gy)[1]}
        stroke="rgb(var(--accent))"
        strokeOpacity={major ? 0.16 : 0.06}
        strokeWidth={major ? 0.8 : 0.5}
      />,
    );
  }
  return (
    <g>
      <polygon
        points={pts([project(x, y), project(x + width, y), project(x + width, y + height), project(x, y + height)])}
        fill="rgb(var(--navy))"
        stroke="rgb(var(--accent) / 0.25)"
        strokeWidth={1}
      />
      {lines}
    </g>
  );
}

export function IsoRoom({
  room,
  selected,
  overlapping,
  interactive,
  selectedDeviceId,
  handlers,
  layer = "body",
  showDevices = true,
}: {
  /** Hide the device cubes on the floor (the count in the label stays). */
  showDevices?: boolean;
  /** Rooms are drawn in passes so labels and handles always sit on top. */
  layer?: "body" | "label" | "handles";
  room: SceneRoom;
  selected: boolean;
  overlapping: boolean;
  interactive: boolean;
  selectedDeviceId?: string | null;
  handlers?: Handlers;
}) {
  const { x, y, width: w, height: h } = room;
  const colour = ROOM_COLOURS[room.type] ?? ROOM_COLOURS.OTHER!;
  const T = SLAB;
  const A0 = project(x, y, 0), B0 = project(x + w, y, 0), C0 = project(x + w, y + h, 0), D0 = project(x, y + h, 0);
  const AT = project(x, y, T), BT = project(x + w, y, T), CT = project(x + w, y + h, T), DT = project(x, y + h, T);
  const AW = project(x, y, T + WALL), BW = project(x + w, y, T + WALL), DW = project(x, y + h, T + WALL);
  const BL = project(x + w, y, T + LIP), CL = project(x + w, y + h, T + LIP), DL = project(x, y + h, T + LIP);

  const outline = overlapping ? "rgb(var(--danger))" : selected ? "rgb(var(--accent))" : colour;
  // Only attach handlers when interactive: server-rendered previews must not carry functions.
  const down = (mode: DragMode) =>
    handlers?.onRoomPointerDown ? (e: React.PointerEvent) => handlers.onRoomPointerDown!(e, room.id, mode) : undefined;
  const { positions, overflow } = deviceSlots(room, showDevices ? room.devices.length : 0);
  const [lx, ly] = project(x + w / 2, y + h / 2, T);
  const metres = (v: number) => `${Math.round((v / UNIT) * 10) / 10} m`;
  void A0;

  if (layer === "label") {
    return (
      <g>
      {/* Label */}
        <g pointerEvents="none">
          <text
            x={lx}
            y={ly - 4}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            className="fill-fg"
            style={{ paintOrder: "stroke", stroke: "rgb(var(--bg))", strokeWidth: 3, strokeLinejoin: "round" }}
          >
            {room.name}
          </text>
          <text
            x={lx}
            y={ly + 9}
            textAnchor="middle"
            fontSize={9}
            className="fill-muted"
            style={{ paintOrder: "stroke", stroke: "rgb(var(--bg))", strokeWidth: 3, strokeLinejoin: "round" }}
          >
            {isCirculation(room.type)
            ? room.type === "STAIRS"
              ? "Up and down"
              : "Between floors"
            : room.devices.length === 0
              ? "No devices"
              : `${room.devices.length} ${room.devices.length === 1 ? "device" : "devices"}`}
            {showDevices && overflow > 0 ? ` (${overflow} not shown)` : ""}
          </text>
        </g>

      </g>
    );
  }

  if (layer === "handles") {
    if (!selected || !interactive) return null;
    return (
      <g>
          <DimensionLabel at={project(x + w / 2, y + h, 0)} text={`${metres(w)} wide`} dx={-24} dy={16} />
          <DimensionLabel at={project(x + w, y + h / 2, 0)} text={`${metres(h)} deep`} dx={24} dy={16} />
          <Handle at={project(x + w, y + h / 2, T)} label="Drag to change width" onPointerDown={down("width")} />
          <Handle at={project(x + w / 2, y + h, T)} label="Drag to change depth" onPointerDown={down("depth")} />
          <Handle at={CT} big label="Drag to resize" onPointerDown={down("both")} />
      </g>
    );
  }

  return (
    <g data-room={room.id} style={{ cursor: interactive ? "grab" : "pointer" }}>
      {/* Slab sides */}
      <polygon points={pts([D0, C0, CT, DT])} fill={colour} fillOpacity={0.55} />
      <polygon points={pts([D0, C0, CT, DT])} fill="#000" fillOpacity={0.35} />
      <polygon points={pts([B0, C0, CT, BT])} fill={colour} fillOpacity={0.55} />
      <polygon points={pts([B0, C0, CT, BT])} fill="#000" fillOpacity={0.5} />

      {/* Back walls (north and west), translucent so nothing hides behind them */}
      <polygon points={pts([AT, BT, BW, AW])} fill={colour} fillOpacity={0.22} stroke={colour} strokeOpacity={0.55} strokeWidth={0.8} />
      <polygon points={pts([AT, DT, DW, AW])} fill={colour} fillOpacity={0.32} stroke={colour} strokeOpacity={0.55} strokeWidth={0.8} />

      {/* Floor */}
      <polygon
        points={pts([AT, BT, CT, DT])}
        fill={colour}
        fillOpacity={selected ? 0.38 : 0.26}
        stroke={outline}
        strokeWidth={selected || overlapping ? 2 : 1}
        strokeLinejoin="round"
        onPointerDown={down("move")}
      />

      {room.type === "STAIRS" ? <StairFlight room={room} colour={colour} /> : null}
      {room.type === "LIFT" ? <LiftCar room={room} colour={colour} /> : null}

      {/* Devices on the floor */}
      {positions.map((p, i) => {
        const d = room.devices[i]!;
        const s = 0.8 * UNIT;
        const ht = 9;
        const fill = DEVICE_COLOUR[d.status] ?? DEVICE_COLOUR.ACTIVE!;
        const top = [project(p.x, p.y, T + ht), project(p.x + s, p.y, T + ht), project(p.x + s, p.y + s, T + ht), project(p.x, p.y + s, T + ht)];
        const left = [project(p.x, p.y + s, T), project(p.x + s, p.y + s, T), project(p.x + s, p.y + s, T + ht), project(p.x, p.y + s, T + ht)];
        const right = [project(p.x + s, p.y, T), project(p.x + s, p.y + s, T), project(p.x + s, p.y + s, T + ht), project(p.x + s, p.y, T + ht)];
        const active = selectedDeviceId === d.id;
        return (
          <g
            key={d.id}
            style={{ cursor: "pointer" }}
            onPointerDown={handlers?.onDevicePointerDown ? (e) => handlers.onDevicePointerDown!(e, d.id, room.id) : undefined}
          >
            <title>{d.name}</title>
            <polygon points={pts(left)} fill={fill} />
            <polygon points={pts(left)} fill="#000" fillOpacity={0.3} />
            <polygon points={pts(right)} fill={fill} />
            <polygon points={pts(right)} fill="#000" fillOpacity={0.45} />
            <polygon points={pts(top)} fill={fill} stroke={active ? "rgb(var(--accent))" : "none"} strokeWidth={2} />
          </g>
        );
      })}

      {/* Low front walls (south and east) */}
      <polygon points={pts([DT, CT, CL, DL])} fill={colour} fillOpacity={0.45} pointerEvents="none" />
      <polygon points={pts([BT, CT, CL, BL])} fill={colour} fillOpacity={0.6} pointerEvents="none" />

    </g>
  );
}

function Handle({ at, big, label, onPointerDown }: { at: [number, number]; big?: boolean; label: string; onPointerDown?: (e: React.PointerEvent) => void }) {
  return (
    <g style={{ cursor: "crosshair" }} onPointerDown={onPointerDown}>
      <title>{label}</title>
      {/* Large invisible hit area for fingers */}
      <circle cx={at[0]} cy={at[1]} r={14} fill="transparent" />
      <circle cx={at[0]} cy={at[1]} r={big ? 6.5 : 5} fill="rgb(var(--accent))" stroke="rgb(var(--bg))" strokeWidth={2} />
    </g>
  );
}

function DimensionLabel({ at, text, dx, dy }: { at: [number, number]; text: string; dx: number; dy: number }) {
  return (
    <text
      x={at[0] + dx}
      y={at[1] + dy}
      textAnchor="middle"
      fontSize={10}
      fontWeight={600}
      fill="rgb(var(--accent))"
      pointerEvents="none"
      style={{ paintOrder: "stroke", stroke: "rgb(var(--bg))", strokeWidth: 3 }}
    >
      {text}
    </text>
  );
}

/** Convenience: the full static scene (used for previews and the home page). */
export function IsoScene({
  rooms,
  cables = [],
  accessPoints = [],
  cabinets = [],
  trolleys = [],
  selectedId,
}: {
  rooms: SceneRoom[];
  cables?: SceneCable[];
  accessPoints?: SceneAccessPoint[];
  cabinets?: SceneCabinet[];
  trolleys?: SceneCabinet[];
  selectedId?: string | null;
}) {
  const ground = groundBounds(rooms);
  const sorted = paintOrder(rooms);
  return (
    <g>
      <IsoGround ground={ground} />
      {sorted.map((r) => (
        <IsoRoom key={`body-${r.id}`} layer="body" room={r} selected={r.id === selectedId} overlapping={false} interactive={false} />
      ))}
      {accessPoints.map((ap) => (
        <IsoCoverage key={`cov-${ap.id}`} ap={ap} />
      ))}
      {[...cabinets]
        .sort((a, b) => a.x + a.y - (b.x + b.y))
        .map((c) => (
          <IsoCabinet key={c.id} cabinet={c} selected={false} />
        ))}
      {[...trolleys]
        .sort((a, b) => a.x + a.y - (b.x + b.y))
        .map((t) => (
          <IsoTrolley key={t.id} trolley={t} selected={false} />
        ))}
      {cables.map((c) => (
        <IsoCable key={c.id} cable={c} selected={false} />
      ))}
      {sorted.map((r) => (
        <IsoRoom key={`label-${r.id}`} layer="label" room={r} selected={r.id === selectedId} overlapping={false} interactive={false} />
      ))}
      {accessPoints.map((ap) => (
        <IsoAccessPoint key={ap.id} ap={ap} selected={false} />
      ))}
    </g>
  );
}

// ─── Cable runs ──────────────────────────────────────────────────────────

/**
 * A cable run drawn just above floor level, on top of the rooms so it's never
 * hidden. Fibre is dashed so it reads differently from copper at a glance.
 */
export function IsoCable({
  cable,
  selected,
  dimmed,
  onPointerDown,
  onVertexPointerDown,
}: {
  cable: SceneCable;
  selected: boolean;
  dimmed?: boolean;
  onPointerDown?: (event: React.PointerEvent, cableId: string) => void;
  onVertexPointerDown?: (event: React.PointerEvent, cableId: string, index: number) => void;
}) {
  if (cable.points.length < 2) return null;
  const colour = CABLE_COLOURS[cable.type] ?? CABLE_COLOURS.OTHER!;
  const screen = cable.points.map((p) => project(p.x, p.y, CABLE_Z));
  const line = pts(screen);
  const fibre = isFibre(cable.type);
  const start = screen[0]!;
  const end = screen[screen.length - 1]!;

  // Label sits on the middle of the longest segment.
  let best = 0;
  for (let i = 1; i < screen.length; i++) {
    const len = Math.hypot(screen[i]![0] - screen[i - 1]![0], screen[i]![1] - screen[i - 1]![1]);
    const bestLen = Math.hypot(screen[best + 1]![0] - screen[best]![0], screen[best + 1]![1] - screen[best]![1]);
    if (len > bestLen) best = i - 1;
  }
  const mid: [number, number] = [(screen[best]![0] + screen[best + 1]![0]) / 2, (screen[best]![1] + screen[best + 1]![1]) / 2];
  const label = `${CABLE_SHORT_LABELS[cable.type]}, ${cable.lengthMetres} m`;

  return (
    <g opacity={dimmed ? 0.35 : 1} style={{ cursor: onPointerDown ? "pointer" : undefined }}>
      <title>{`${cable.name} (${label})`}</title>
      {/* Soft glow, then the cable itself; a wide invisible stroke makes it easy to tap. */}
      <polyline points={line} fill="none" stroke={colour} strokeOpacity={selected ? 0.35 : 0.18} strokeWidth={selected ? 9 : 6} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
      <polyline
        points={line}
        fill="none"
        stroke={colour}
        strokeWidth={selected ? 3 : 2.2}
        strokeDasharray={fibre ? "7 4" : undefined}
        strokeLinejoin="round"
        strokeLinecap="round"
        pointerEvents="none"
      />
      {selected ? (
        <polyline points={line} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={1.2} strokeDasharray="2 14" className="animate-[sv-flow_1.2s_linear_infinite]" pointerEvents="none" />
      ) : null}
      {onPointerDown ? (
        <polyline
          points={line}
          fill="none"
          stroke="transparent"
          strokeWidth={16}
          strokeLinejoin="round"
          onPointerDown={(e) => onPointerDown(e, cable.id)}
        />
      ) : null}
      <circle cx={start[0]} cy={start[1]} r={3.5} fill={colour} stroke="rgb(var(--bg))" strokeWidth={1.5} pointerEvents="none" />
      <circle cx={end[0]} cy={end[1]} r={3.5} fill={colour} stroke="rgb(var(--bg))" strokeWidth={1.5} pointerEvents="none" />

      {selected ? (
        <g pointerEvents="none">
          <rect x={mid[0] - label.length * 2.9 - 6} y={mid[1] - 22} width={label.length * 5.8 + 12} height={15} rx={7.5} fill="rgb(var(--bg))" stroke={colour} strokeWidth={1} />
          <text x={mid[0]} y={mid[1] - 11.5} textAnchor="middle" fontSize={9.5} fontWeight={600} fill={colour}>
            {label}
          </text>
        </g>
      ) : null}

      {selected && onVertexPointerDown
        ? screen.map((p, i) => (
            <g key={i} style={{ cursor: "move" }} onPointerDown={(e) => onVertexPointerDown(e, cable.id, i)}>
              <circle cx={p[0]} cy={p[1]} r={12} fill="transparent" />
              <circle cx={p[0]} cy={p[1]} r={4.5} fill="rgb(var(--bg))" stroke={colour} strokeWidth={2} />
            </g>
          ))
        : null}
    </g>
  );
}

// ─── Access points ───────────────────────────────────────────────────────

export type SceneAccessPoint = { id: string; name: string; status: string; x: number; y: number };

const AP_COLOUR = "#38BDF8";

/** Wi-Fi coverage guide on the floor, drawn beneath everything else. */
export function IsoCoverage({ ap }: { ap: SceneAccessPoint }) {
  const r = AP_COVERAGE_M * UNIT;
  const [cx, cy] = project(ap.x, ap.y, SLAB);
  const down = ap.status !== "ACTIVE";
  return (
    <g pointerEvents="none">
      <ellipse cx={cx} cy={cy} rx={r * Math.SQRT2 * COS} ry={r * Math.SQRT2 * SIN} fill={down ? "#F2B544" : AP_COLOUR} fillOpacity={0.07} stroke={down ? "#F2B544" : AP_COLOUR} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="4 5" />
      <ellipse cx={cx} cy={cy} rx={r * 0.5 * Math.SQRT2 * COS} ry={r * 0.5 * Math.SQRT2 * SIN} fill={down ? "#F2B544" : AP_COLOUR} fillOpacity={0.08} />
    </g>
  );
}

/** A ceiling-mounted access point: a puck above the room with a drop line. */
export function IsoAccessPoint({
  ap,
  selected,
  onPointerDown,
}: {
  ap: SceneAccessPoint;
  selected: boolean;
  onPointerDown?: (event: React.PointerEvent, id: string) => void;
}) {
  const [fx, fy] = project(ap.x, ap.y, SLAB);
  const [px, py] = project(ap.x, ap.y, SLAB + WALL + 8);
  const colour = ap.status === "ACTIVE" ? AP_COLOUR : "#F2B544";
  return (
    <g style={{ cursor: onPointerDown ? "pointer" : undefined }} onPointerDown={onPointerDown ? (e) => onPointerDown(e, ap.id) : undefined}>
      <title>{ap.name}</title>
      <line x1={fx} y1={fy} x2={px} y2={py} stroke={colour} strokeOpacity={0.6} strokeWidth={1} strokeDasharray="2 3" />
      <ellipse cx={fx} cy={fy} rx={4} ry={2.3} fill={colour} fillOpacity={0.6} />
      {selected ? <ellipse cx={px} cy={py} rx={17} ry={10} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} /> : null}
      <ellipse cx={px} cy={py + 2.5} rx={11} ry={6.3} fill="#0b1220" fillOpacity={0.5} />
      <ellipse cx={px} cy={py} rx={11} ry={6.3} fill="#F8FAFC" stroke={colour} strokeWidth={1.6} />
      {/* Wi-Fi glyph */}
      <path d={`M ${px - 4.5} ${py - 0.5} Q ${px} ${py - 4.5} ${px + 4.5} ${py - 0.5}`} fill="none" stroke={colour} strokeWidth={1.3} strokeLinecap="round" />
      <path d={`M ${px - 2.5} ${py + 0.8} Q ${px} ${py - 1.6} ${px + 2.5} ${py + 0.8}`} fill="none" stroke={colour} strokeWidth={1.3} strokeLinecap="round" />
      <circle cx={px} cy={py + 2.2} r={0.9} fill={colour} />
      {/* Big invisible hit area */}
      <ellipse cx={px} cy={py} rx={16} ry={11} fill="transparent" />
    </g>
  );
}

// ─── Cabinets ────────────────────────────────────────────────────────────

export type SceneCabinet = { id: string; name: string; status: string; x: number; y: number; rackUnits: number; usedUnits: number; itemCount: number };

/** A floor-standing rack cabinet, centred on (x, y), with its fill shown on the front. */
export function IsoCabinet({
  cabinet,
  selected,
  onPointerDown,
}: {
  cabinet: SceneCabinet;
  selected: boolean;
  onPointerDown?: (event: React.PointerEvent, id: string) => void;
}) {
  const x0 = cabinet.x - CABINET_W / 2;
  const y0 = cabinet.y - CABINET_D / 2;
  const x1 = x0 + CABINET_W;
  const y1 = y0 + CABINET_D;
  const b = SLAB;
  const t = SLAB + CABINET_H;
  const top = [project(x0, y0, t), project(x1, y0, t), project(x1, y1, t), project(x0, y1, t)];
  const front = [project(x0, y1, b), project(x1, y1, b), project(x1, y1, t), project(x0, y1, t)]; // south face
  const side = [project(x1, y0, b), project(x1, y1, b), project(x1, y1, t), project(x1, y0, t)]; // east face
  const fill = Math.min(1, cabinet.rackUnits ? cabinet.usedUnits / cabinet.rackUnits : 0);
  const slots = 8;
  const outline = selected ? "rgb(var(--accent))" : "#64748B";

  return (
    <g style={{ cursor: onPointerDown ? "pointer" : undefined }} onPointerDown={onPointerDown ? (e) => onPointerDown(e, cabinet.id) : undefined}>
      <title>{`${cabinet.name}: ${cabinet.usedUnits} of ${cabinet.rackUnits}U used`}</title>
      <polygon points={pts(side)} fill="#111827" stroke={outline} strokeWidth={selected ? 1.6 : 0.8} />
      <polygon points={pts(front)} fill="#1F2937" stroke={outline} strokeWidth={selected ? 1.6 : 0.8} />
      {/* Rack slots, lit from the bottom up to show how full it is */}
      {Array.from({ length: slots }, (_, i) => {
        const zA = b + 4 + (i * (CABINET_H - 8)) / slots;
        const zB = zA + (CABINET_H - 8) / slots - 1.5;
        const lit = (i + 1) / slots <= fill + 0.001 || (fill > 0 && i === 0);
        const inset = 2.5;
        const face = [project(x0 + inset, y1, zA), project(x1 - inset, y1, zA), project(x1 - inset, y1, zB), project(x0 + inset, y1, zB)];
        return <polygon key={i} points={pts(face)} fill={lit ? "#2DC4B6" : "#374151"} fillOpacity={lit ? 0.85 : 0.6} />;
      })}
      <polygon points={pts(top)} fill="#4B5563" stroke={outline} strokeWidth={selected ? 1.6 : 0.8} />
    </g>
  );
}

/** Small label above a cabinet or access point when selected. */
export function MarkerLabel({ x, y, z, text }: { x: number; y: number; z: number; text: string }) {
  const [lx, ly] = project(x, y, z);
  const w = text.length * 5.6 + 14;
  return (
    <g pointerEvents="none">
      <rect x={lx - w / 2} y={ly - 24} width={w} height={16} rx={8} fill="rgb(var(--bg))" stroke="rgb(var(--accent))" strokeWidth={1} />
      <text x={lx} y={ly - 13} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="rgb(var(--accent))">
        {text}
      </text>
    </g>
  );
}

export const CABINET_TOP_Z = SLAB + CABINET_H;
export const AP_TOP_Z = SLAB + WALL + 8;

// ─── Stairs and lifts ────────────────────────────────────────────────────

/**
 * A flight of steps filling the room, rising towards the back so the treads
 * face the viewer. Runs along the room's longer side.
 */
function StairFlight({ room, colour }: { room: Rect; colour: string }) {
  const { x, y, width: w, height: h } = room;
  const steps = 8;
  const rise = (WALL * 0.85) / steps;
  const alongX = w > h; // rises towards the west (left-back) when wide, else towards the north
  const inset = 3;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < steps; i++) {
    // i = 0 is the back (highest) step; draw back to front.
    const top = SLAB + (steps - i) * rise;
    let x0 = x + inset, x1 = x + w - inset, y0 = y + inset, y1 = y + h - inset;
    if (alongX) {
      const run = (w - inset * 2) / steps;
      x0 = x + inset + i * run;
      x1 = x0 + run;
    } else {
      const run = (h - inset * 2) / steps;
      y0 = y + inset + i * run;
      y1 = y0 + run;
    }
    const tread = [project(x0, y0, top), project(x1, y0, top), project(x1, y1, top), project(x0, y1, top)];
    const riserS = [project(x0, y1, SLAB), project(x1, y1, SLAB), project(x1, y1, top), project(x0, y1, top)];
    const riserE = [project(x1, y0, SLAB), project(x1, y1, SLAB), project(x1, y1, top), project(x1, y0, top)];
    out.push(
      <g key={i} pointerEvents="none">
        <polygon points={pts(riserE)} fill={colour} fillOpacity={0.35} />
        <polygon points={pts(riserE)} fill="#000" fillOpacity={0.35} />
        <polygon points={pts(riserS)} fill={colour} fillOpacity={0.45} />
        <polygon points={pts(riserS)} fill="#000" fillOpacity={0.18} />
        <polygon points={pts(tread)} fill={colour} fillOpacity={0.75} stroke="#000" strokeOpacity={0.15} strokeWidth={0.5} />
      </g>,
    );
  }
  return <g>{out}</g>;
}

/** A lift car: a tall box with a door line and up/down arrows on top. */
function LiftCar({ room, colour }: { room: Rect; colour: string }) {
  const pad = Math.min(room.width, room.height) * 0.15;
  const x0 = room.x + pad, x1 = room.x + room.width - pad, y0 = room.y + pad, y1 = room.y + room.height - pad;
  const top = SLAB + WALL * 0.9;
  const front = [project(x0, y1, SLAB), project(x1, y1, SLAB), project(x1, y1, top), project(x0, y1, top)];
  const side = [project(x1, y0, SLAB), project(x1, y1, SLAB), project(x1, y1, top), project(x1, y0, top)];
  const lid = [project(x0, y0, top), project(x1, y0, top), project(x1, y1, top), project(x0, y1, top)];
  const doorA = project((x0 + x1) / 2, y1, SLAB);
  const doorB = project((x0 + x1) / 2, y1, top - 4);
  const [cx, cy] = project((x0 + x1) / 2, (y0 + y1) / 2, top);
  return (
    <g pointerEvents="none">
      <polygon points={pts(side)} fill={colour} fillOpacity={0.5} />
      <polygon points={pts(side)} fill="#000" fillOpacity={0.4} />
      <polygon points={pts(front)} fill={colour} fillOpacity={0.55} />
      <line x1={doorA[0]} y1={doorA[1]} x2={doorB[0]} y2={doorB[1]} stroke="#000" strokeOpacity={0.45} strokeWidth={1} />
      <polygon points={pts(lid)} fill={colour} fillOpacity={0.85} />
      <path d={`M ${cx - 5} ${cy - 1} l 3 -3.5 l 3 3.5 M ${cx + 1} ${cy + 1} l 3 3.5 l 3 -3.5`} fill="none" stroke="#1F2937" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

// ─── Trolleys ────────────────────────────────────────────────────────────

/** A charging trolley on wheels, with lit bays showing how full it is. */
export function IsoTrolley({
  trolley,
  selected,
  onPointerDown,
}: {
  trolley: SceneCabinet;
  selected: boolean;
  onPointerDown?: (event: React.PointerEvent, id: string) => void;
}) {
  const wheel = 3;
  const x0 = trolley.x - TROLLEY_W / 2, x1 = x0 + TROLLEY_W;
  const y0 = trolley.y - TROLLEY_D / 2, y1 = y0 + TROLLEY_D;
  const b = SLAB + wheel;
  const t = b + TROLLEY_H;
  const top = [project(x0, y0, t), project(x1, y0, t), project(x1, y1, t), project(x0, y1, t)];
  const front = [project(x0, y1, b), project(x1, y1, b), project(x1, y1, t), project(x0, y1, t)];
  const side = [project(x1, y0, b), project(x1, y1, b), project(x1, y1, t), project(x1, y0, t)];
  const fill = trolley.rackUnits ? Math.min(1, trolley.usedUnits / trolley.rackUnits) : 0;
  const bays = 6;
  const outline = selected ? "rgb(var(--accent))" : "#475569";
  const wheels = [project(x0 + 2, y1, SLAB + wheel / 2), project(x1 - 2, y1, SLAB + wheel / 2), project(x1, y0 + 2, SLAB + wheel / 2)];
  return (
    <g style={{ cursor: onPointerDown ? "pointer" : undefined }} onPointerDown={onPointerDown ? (e) => onPointerDown(e, trolley.id) : undefined}>
      <title>{`${trolley.name}: ${trolley.usedUnits} of ${trolley.rackUnits} bays in use`}</title>
      {wheels.map(([wx, wy], i) => (
        <ellipse key={i} cx={wx} cy={wy} rx={2.2} ry={1.6} fill="#111827" />
      ))}
      <polygon points={pts(side)} fill="#1E3A5F" stroke={outline} strokeWidth={selected ? 1.6 : 0.8} />
      <polygon points={pts(front)} fill="#2B5482" stroke={outline} strokeWidth={selected ? 1.6 : 0.8} />
      {Array.from({ length: bays }, (_, i) => {
        const xa = x0 + 2 + (i * (TROLLEY_W - 4)) / bays;
        const xb = xa + (TROLLEY_W - 4) / bays - 1.2;
        const lit = (i + 1) / bays <= fill + 0.001 || (fill > 0 && i === 0);
        const face = [project(xa, y1, b + 3), project(xb, y1, b + 3), project(xb, y1, t - 3), project(xa, y1, t - 3)];
        return <polygon key={i} points={pts(face)} fill={lit ? "#FBBF24" : "#334155"} fillOpacity={lit ? 0.9 : 0.7} />;
      })}
      <polygon points={pts(top)} fill="#3B6EA5" stroke={outline} strokeWidth={selected ? 1.6 : 0.8} />
    </g>
  );
}

export const TROLLEY_TOP_Z = SLAB + 3 + TROLLEY_H;
