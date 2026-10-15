// Splits a floor's equipment into what's drawn where: access points on the
// ceiling, cabinets on the floor, and everything else as devices in the room.
import { markerPosition, type Rect } from "./iso";
import type { SceneAccessPoint, SceneCabinet, SceneDevice } from "./iso-scene";

export type MarkerAsset = {
  id: string;
  name: string;
  type: string;
  status: string;
  cabinetId: string | null;
  rackUnits: number | null;
  mapX?: number | null;
  mapY?: number | null;
};

export type MarkerRoom = Rect & { id: string; assets: MarkerAsset[] };

export const isLooseDevice = (a: MarkerAsset) => a.type !== "ACCESS_POINT" && a.type !== "CABINET" && a.type !== "TROLLEY" && !a.cabinetId;

export function floorMarkers(rooms: MarkerRoom[]) {
  const all = rooms.flatMap((r) => r.assets);
  const accessPoints: (SceneAccessPoint & { roomId: string })[] = [];
  const cabinets: (SceneCabinet & { roomId: string })[] = [];
  const trolleys: (SceneCabinet & { roomId: string })[] = [];
  const devicesByRoom = new Map<string, SceneDevice[]>();

  for (const room of rooms) {
    const aps = room.assets.filter((a) => a.type === "ACCESS_POINT");
    aps.forEach((a, i) => {
      const p = markerPosition(room, "ap", a, i, aps.length);
      accessPoints.push({ id: a.id, name: a.name, status: a.status, x: p.x, y: p.y, roomId: room.id });
    });

    const cabs = room.assets.filter((a) => a.type === "CABINET");
    cabs.forEach((a, i) => {
      const p = markerPosition(room, "cabinet", a, i, cabs.length);
      const contents = all.filter((c) => c.cabinetId === a.id);
      cabinets.push({
        id: a.id,
        name: a.name,
        status: a.status,
        x: p.x,
        y: p.y,
        rackUnits: a.rackUnits ?? 42,
        usedUnits: contents.reduce((n, c) => n + (c.rackUnits ?? 1), 0),
        itemCount: contents.length,
        roomId: room.id,
      });
    });

    const carts = room.assets.filter((a) => a.type === "TROLLEY");
    carts.forEach((a, i) => {
      const p = markerPosition(room, "trolley", a, i, carts.length);
      const contents = all.filter((c) => c.cabinetId === a.id);
      trolleys.push({
        id: a.id,
        name: a.name,
        status: a.status,
        x: p.x,
        y: p.y,
        rackUnits: a.rackUnits ?? 32,
        usedUnits: contents.length,
        itemCount: contents.length,
        roomId: room.id,
      });
    });

    devicesByRoom.set(
      room.id,
      room.assets.filter(isLooseDevice).map((a) => ({ id: a.id, name: a.name, type: a.type, status: a.status })),
    );
  }

  return { accessPoints, cabinets, trolleys, devicesByRoom };
}
