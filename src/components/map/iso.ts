// Isometric projection helpers for the floor builder. Pure functions only.
//
// World space: x runs east, y runs south, z up. 20 world units = 1 metre.
// Screen space is the SVG user space. Points further east/south sit lower
// on screen, so the viewer looks at the south and east faces of each room.

export const UNIT = 20; // world units per metre
export const COS = Math.cos(Math.PI / 6); // 0.866
export const SIN = 0.5;

export const SLAB = 6; // floor slab thickness
export const WALL = 34; // back wall height
export const LIP = 7; // front wall height (kept low so you can see inside)
export const CABLE_Z = SLAB + 2; // cables are drawn just above floor level

export type Pt = [number, number];
export type Rect = { x: number; y: number; width: number; height: number };

export function project(x: number, y: number, z = 0): Pt {
  return [(x - y) * COS, (x + y) * SIN - z];
}

/** Inverse of `project` for a screen point on the plane at height z. */
export function unproject(sx: number, sy: number, z = 0): { x: number; y: number } {
  const diff = sx / COS; // x - y
  const sum = (sy + z) / SIN; // x + y
  return { x: (sum + diff) / 2, y: (sum - diff) / 2 };
}

export const pts = (points: Pt[]) => points.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");

export const snap = (value: number, step = UNIT) => Math.round(value / step) * step;

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Back-to-front order so nearer rooms paint over further ones. */
export const depthOf = (r: Rect) => r.x + r.width / 2 + r.y + r.height / 2;

/** Area shown as the ground plate: all rooms plus a margin, with a sensible minimum. */
export function groundBounds(rooms: Rect[], minWidth = 30 * UNIT, minDepth = 20 * UNIT): Rect {
  const margin = 2 * UNIT;
  if (rooms.length === 0) return { x: -margin, y: -margin, width: minWidth, height: minDepth };
  const minX = Math.min(...rooms.map((r) => r.x)) - margin;
  const minY = Math.min(...rooms.map((r) => r.y)) - margin;
  const maxX = Math.max(...rooms.map((r) => r.x + r.width)) + margin;
  const maxY = Math.max(...rooms.map((r) => r.y + r.height)) + margin;
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, minWidth),
    height: Math.max(maxY - minY, minDepth),
  };
}

/** SVG viewBox that fits the ground plate and wall heights. */
export function fitViewBox(ground: Rect, pad = 36): { x: number; y: number; width: number; height: number } {
  const corners: Pt[] = [
    project(ground.x, ground.y, WALL + SLAB),
    project(ground.x + ground.width, ground.y, WALL + SLAB),
    project(ground.x, ground.y + ground.height, 0),
    project(ground.x + ground.width, ground.y + ground.height, 0),
    project(ground.x, ground.y + ground.height, WALL + SLAB),
    project(ground.x + ground.width, ground.y, 0),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad - 30; // room for labels on the back row
  return { x: minX, y: minY, width: Math.max(...xs) + pad - minX, height: Math.max(...ys) + pad - minY };
}

/** Room colours by type: [floor, wall] hex values that read on navy and white. */
export const ROOM_COLOURS: Record<string, string> = {
  CLASSROOM: "#2DC4B6",
  OFFICE: "#5BA8F5",
  IT_SUITE: "#9B8CF5",
  SERVER_ROOM: "#F0616D",
  COMMS_CABINET: "#F2B544",
  HALL: "#3DD68C",
  LIBRARY: "#E58FD0",
  STAFFROOM: "#F59E6B",
  CORRIDOR: "#8A98AB",
  STAIRS: "#FBBF24",
  LIFT: "#C084FC",
  OTHER: "#A3B1C2",
};

/** Room types drawn as circulation (stairs, lifts) rather than ordinary rooms. */
export const isCirculation = (type: string) => type === "STAIRS" || type === "LIFT";

/** Where to place `count` device markers on a room floor, in world units. */
export function deviceSlots(room: Rect, count: number): { positions: { x: number; y: number }[]; overflow: number } {
  const cell = 1.6 * UNIT;
  const inset = 0.9 * UNIT;
  const cols = Math.max(1, Math.floor((room.width - inset * 2) / cell) + 1);
  const rows = Math.max(1, Math.floor((room.height - inset * 2) / cell) + 1);
  const capacity = cols * rows;
  const shown = Math.min(count, capacity);
  const positions = Array.from({ length: shown }, (_, i) => ({
    x: room.x + inset + (i % cols) * cell,
    y: room.y + inset + Math.floor(i / cols) * cell,
  }));
  return { positions, overflow: count - shown };
}

/**
 * Painter's order for rooms. A room must be drawn before another if it sits
 * entirely north or west of it (further from the viewer). A topological sort
 * handles long thin rooms such as corridors, which a simple centre-depth sort
 * gets wrong. Overlapping rooms (no clear order) fall back to centre depth.
 */
export function paintOrder<T extends Rect>(rooms: T[]): T[] {
  const n = rooms.length;
  const before = (a: Rect, b: Rect) =>
    (a.x + a.width <= b.x && a.y < b.y + b.height) || (a.y + a.height <= b.y && a.x < b.x + b.width);
  const indegree = new Array<number>(n).fill(0);
  const edges: number[][] = rooms.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && before(rooms[i]!, rooms[j]!)) {
        edges[i]!.push(j);
        indegree[j]! += 1;
      }
    }
  }
  const ready = rooms.map((_, i) => i).filter((i) => indegree[i] === 0);
  const out: T[] = [];
  const placed = new Set<number>();
  while (out.length < n) {
    if (ready.length === 0) {
      // Cycle (overlapping rooms): take the furthest remaining room.
      const rest = rooms.map((_, i) => i).filter((i) => !placed.has(i));
      rest.sort((a, b) => depthOf(rooms[a]!) - depthOf(rooms[b]!));
      ready.push(rest[0]!);
    }
    ready.sort((a, b) => depthOf(rooms[a]!) - depthOf(rooms[b]!));
    const i = ready.shift()!;
    if (placed.has(i)) continue;
    placed.add(i);
    out.push(rooms[i]!);
    for (const j of edges[i]!) {
      indegree[j]! -= 1;
      if (indegree[j] === 0 && !placed.has(j)) ready.push(j);
    }
  }
  return out;
}

// ─── Access points and cabinets ─────────────────────────────────────────

export const AP_COVERAGE_M = 12; // typical indoor radius shown as a guide
export const CABINET_W = 0.8 * UNIT; // footprint, east-west
export const CABINET_D = 1.0 * UNIT; // footprint, north-south
export const CABINET_H = 40; // drawn height (about 2 m)
export const TROLLEY_W = 1.1 * UNIT;
export const TROLLEY_D = 0.6 * UNIT;
export const TROLLEY_H = 18; // about 1 m

/**
 * Where a marker sits on the floor. Stored positions are relative to the
 * room's top-left; devices without one are spread out automatically.
 */
export function markerPosition(
  room: Rect,
  kind: "ap" | "cabinet" | "trolley",
  stored: { mapX?: number | null; mapY?: number | null },
  index: number,
  count: number,
): { x: number; y: number } {
  const margin = kind === "cabinet" ? CABINET_D / 2 + 4 : 10;
  const clampX = (v: number) => Math.min(room.x + room.width - margin, Math.max(room.x + margin, v));
  const clampY = (v: number) => Math.min(room.y + room.height - margin, Math.max(room.y + margin, v));
  if (stored.mapX !== null && stored.mapX !== undefined && stored.mapY !== null && stored.mapY !== undefined) {
    return { x: clampX(room.x + stored.mapX), y: clampY(room.y + stored.mapY) };
  }
  if (kind === "ap") {
    return { x: clampX(room.x + (room.width * (index + 1)) / (count + 1)), y: clampY(room.y + room.height / 2) };
  }
  if (kind === "trolley") {
    // Trolleys park along the front (south) wall.
    return { x: clampX(room.x + room.width - 1.0 * UNIT - index * 1.4 * UNIT), y: clampY(room.y + room.height - 0.8 * UNIT) };
  }
  // Cabinets line up along the back (north) wall.
  return { x: clampX(room.x + 0.9 * UNIT + index * 1.3 * UNIT), y: clampY(room.y + 0.8 * UNIT) };
}
