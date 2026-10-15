"use client";

import { useEffect, useRef, useState } from "react";
import { fitViewBox, groundBounds, paintOrder, UNIT } from "@/components/map/iso";
import { IsoCable, IsoGround, IsoRoom, type SceneCable, type SceneRoom } from "@/components/map/iso-scene";
import { pathLengthMetres } from "@/lib/cabling";

/**
 * Home page illustration built from the real floor-plan renderer: rooms appear,
 * equipment fills them, then cable runs trace through the corridor. Loops;
 * shows the finished floor when reduced motion is requested.
 */

const m = (v: number) => v * UNIT;
const devices = (prefix: string, n: number, repair = -1) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: "Device", type: "DESKTOP", status: i === repair ? "IN_REPAIR" : "ACTIVE" }));

const ROOMS: SceneRoom[] = [
  { id: "reception", name: "Reception", type: "OFFICE", x: m(0), y: m(0), width: m(7), height: m(8), devices: devices("r", 3) },
  { id: "hall", name: "Main hall", type: "HALL", x: m(8), y: m(0), width: m(13), height: m(8), devices: devices("h", 2) },
  { id: "server", name: "Server room", type: "SERVER_ROOM", x: m(22), y: m(0), width: m(5), height: m(8), devices: devices("s", 6, 4) },
  { id: "corridor", name: "Corridor", type: "CORRIDOR", x: m(0), y: m(9), width: m(27), height: m(3), devices: [] },
  { id: "it", name: "IT suite", type: "IT_SUITE", x: m(0), y: m(13), width: m(10), height: m(8), devices: devices("i", 12, 7) },
  { id: "library", name: "Library", type: "LIBRARY", x: m(11), y: m(13), width: m(9), height: m(8), devices: devices("l", 6) },
  { id: "lab", name: "Science lab", type: "CLASSROOM", x: m(21), y: m(13), width: m(6), height: m(8), devices: devices("c", 4) },
];

const CABLE_PATHS: Omit<SceneCable, "lengthMetres">[] = [
  {
    id: "fibre",
    name: "Fibre to IT suite",
    type: "FIBRE_MM",
    points: [
      { x: m(24.5), y: m(5) },
      { x: m(24.5), y: m(10.5) },
      { x: m(5), y: m(10.5) },
      { x: m(5), y: m(17) },
    ],
  },
  {
    id: "cat6a",
    name: "Cat6a to Library",
    type: "CAT6A",
    points: [
      { x: m(25.5), y: m(6) },
      { x: m(25.5), y: m(11) },
      { x: m(15.5), y: m(11) },
      { x: m(15.5), y: m(17) },
    ],
  },
];
const CABLES: SceneCable[] = CABLE_PATHS.map((c) => ({ ...c, lengthMetres: pathLengthMetres(c.points) }));
const CABLE_TOTAL = Math.round(CABLES.reduce((n, c) => n + c.lengthMetres, 0));

const ORDER = paintOrder(ROOMS);
const GROUND = groundBounds(ROOMS);
const VIEW = fitViewBox(GROUND, 20);

// Timeline (ms)
const ROOM_STEP = 260;
const DEVICES_AT = ROOMS.length * ROOM_STEP + 300;
const CABLE_START = DEVICES_AT + 900;
const CABLE_DURATION = 1500;
const HOLD_UNTIL = CABLE_START + CABLES.length * CABLE_DURATION + 2600;

/** The first `t` (0..1) of a polyline. */
function partial(points: { x: number; y: number }[], t: number) {
  const seg = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  const total = seg.reduce((a, b) => a + b, 0);
  let remaining = total * Math.min(1, Math.max(0, t));
  const out = [points[0]!];
  for (let i = 0; i < seg.length; i++) {
    if (remaining >= seg[i]!) {
      out.push(points[i + 1]!);
      remaining -= seg[i]!;
    } else {
      const f = remaining / seg[i]!;
      out.push({ x: points[i]!.x + (points[i + 1]!.x - points[i]!.x) * f, y: points[i]!.y + (points[i + 1]!.y - points[i]!.y) * f });
      break;
    }
  }
  return out;
}

export function BuildingHero({ showCaption = true }: { showCaption?: boolean }) {
  const [elapsed, setElapsed] = useState(HOLD_UNTIL);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let start = performance.now();
    setElapsed(0);
    const tick = (now: number) => {
      let t = now - start;
      if (t > HOLD_UNTIL) {
        start = now;
        t = 0;
      }
      setElapsed(t);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  const roomsShown = Math.min(ROOMS.length, Math.floor(elapsed / ROOM_STEP) + 1);
  const shownIds = new Set(ROOMS.slice(0, roomsShown).map((r) => r.id));
  const withDevices = elapsed >= DEVICES_AT;
  const cables = CABLES.map((c, i) => {
    const t = (elapsed - CABLE_START - i * CABLE_DURATION) / CABLE_DURATION;
    return t <= 0 ? null : { ...c, points: partial(c.points, t), lengthMetres: Math.round(c.lengthMetres * Math.min(1, t)) };
  }).filter((c): c is SceneCable => c !== null);

  const deviceCount = ROOMS.reduce((n, r) => n + r.devices.length, 0);
  const caption =
    elapsed < DEVICES_AT
      ? { title: "Laying out the ground floor", body: `${roomsShown} of ${ROOMS.length} rooms placed` }
      : elapsed < CABLE_START
        ? { title: "Placing equipment", body: `${deviceCount} devices, each in the room it lives in` }
        : elapsed < CABLE_START + CABLES.length * CABLE_DURATION
          ? { title: "Tracing cable runs", body: "Multimode fibre and Cat6a from the server room" }
          : { title: "Ground floor mapped", body: `${ROOMS.length} rooms, ${deviceCount} devices, ${CABLES.length} cable runs (${CABLE_TOTAL} m)` };

  return (
    <figure className="relative">
      <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.width} ${VIEW.height}`} className="h-auto w-full" role="img" aria-labelledby="hero-plan-title">
        <title id="hero-plan-title">
          A 3D school floor plan: rooms with equipment inside, and fibre and Cat6a cable runs from the server room.
        </title>
        <IsoGround ground={GROUND} />
        {ORDER.filter((r) => shownIds.has(r.id)).map((r) => (
          <g key={r.id} className="animate-[sv-drop_0.45s_cubic-bezier(.2,.8,.2,1)_both]">
            <IsoRoom layer="body" room={withDevices ? r : { ...r, devices: [] }} selected={false} overlapping={false} interactive={false} />
          </g>
        ))}
        {cables.map((c) => (
          <IsoCable key={c.id} cable={c} selected={false} />
        ))}
        {ORDER.filter((r) => shownIds.has(r.id) && r.type !== "CORRIDOR").map((r) => (
          <IsoRoom key={`l-${r.id}`} layer="label" room={withDevices ? r : { ...r, devices: [] }} selected={false} overlapping={false} interactive={false} />
        ))}
      </svg>
      {showCaption ? (
        <figcaption
          className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-xl border border-line bg-surface/90 px-3.5 py-2.5 text-[13px] backdrop-blur"
          aria-live="polite"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-accent shadow-[0_0_0_4px_rgb(var(--accent)/0.18)]" aria-hidden />
          <span>
            <strong className="font-semibold">{caption.title}.</strong> <span className="text-muted">{caption.body}</span>
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
