/**
 * Seeds the public demonstration workspace: a fictional secondary school with
 * buildings, rooms, equipment, faults and network infrastructure.
 *
 * Safe to run repeatedly and in production: it only ever deletes and rebuilds
 * the demo organisation (slug below) and the shared demo user. Customer data is
 * never touched.
 *
 *   npm run db:seed
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  AssetStatus,
  AssetType,
  FaultPriority,
  FaultStatus,
  LinkKind,
  NetworkNodeType,
  Prisma,
  PrismaClient,
  RoomType,
} from "@prisma/client";

const db = new PrismaClient();

const DEMO_USER_EMAIL = "demo@schoolverse.app";
const DEMO_ORG_SLUG = "demo-northbridge-academy-trust";

// Deterministic pseudo-random numbers so the demo looks the same every time.
let seed = 20261014;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

type RoomSpec = { name: string; type: RoomType; capacity?: number; kit: [AssetType, number][] };

const MAIN_GROUND: RoomSpec[] = [
  { name: "Reception", type: "OFFICE", capacity: 4, kit: [["DESKTOP", 2], ["PRINTER", 1], ["PHONE", 2]] },
  { name: "Main hall", type: "HALL", capacity: 400, kit: [["PROJECTOR", 1], ["ACCESS_POINT", 2]] },
  { name: "Library", type: "LIBRARY", capacity: 60, kit: [["DESKTOP", 6], ["ACCESS_POINT", 1], ["PRINTER", 1]] },
  { name: "Server room", type: "SERVER_ROOM", kit: [["SERVER", 2], ["NAS", 1], ["UPS", 1], ["FIREWALL", 1], ["SWITCH", 1], ["ROUTER", 1]] },
  { name: "Staffroom", type: "STAFFROOM", capacity: 40, kit: [["DESKTOP", 2], ["PRINTER", 1], ["ACCESS_POINT", 1]] },
  { name: "G04 English", type: "CLASSROOM", capacity: 32, kit: [["INTERACTIVE_DISPLAY", 1], ["DESKTOP", 1]] },
  { name: "G05 English", type: "CLASSROOM", capacity: 32, kit: [["INTERACTIVE_DISPLAY", 1], ["DESKTOP", 1]] },
];
const MAIN_FIRST: RoomSpec[] = [
  { name: "F01 IT suite", type: "IT_SUITE", capacity: 30, kit: [["DESKTOP", 14], ["INTERACTIVE_DISPLAY", 1], ["PRINTER", 1]] },
  { name: "F02 Maths", type: "CLASSROOM", capacity: 32, kit: [["INTERACTIVE_DISPLAY", 1], ["DESKTOP", 1]] },
  { name: "F03 Maths", type: "CLASSROOM", capacity: 32, kit: [["PROJECTOR", 1], ["DESKTOP", 1]] },
  { name: "F04 History", type: "CLASSROOM", capacity: 30, kit: [["INTERACTIVE_DISPLAY", 1], ["DESKTOP", 1]] },
  { name: "Comms cabinet F1", type: "COMMS_CABINET", kit: [["SWITCH", 1], ["UPS", 1]] },
  { name: "SLT office", type: "OFFICE", capacity: 6, kit: [["LAPTOP", 4], ["PRINTER", 1]] },
];
const SCIENCE_GROUND: RoomSpec[] = [
  { name: "S01 Biology lab", type: "CLASSROOM", capacity: 28, kit: [["INTERACTIVE_DISPLAY", 1], ["DESKTOP", 1], ["CHROMEBOOK", 8]] },
  { name: "S02 Chemistry lab", type: "CLASSROOM", capacity: 28, kit: [["INTERACTIVE_DISPLAY", 1], ["DESKTOP", 1]] },
  { name: "S03 Physics lab", type: "CLASSROOM", capacity: 28, kit: [["PROJECTOR", 1], ["DESKTOP", 1], ["TABLET", 6]] },
  { name: "Prep room", type: "OTHER", capacity: 4, kit: [["DESKTOP", 1], ["PRINTER", 1]] },
  { name: "Comms cabinet S", type: "COMMS_CABINET", kit: [["SWITCH", 1], ["ACCESS_POINT", 2], ["CAMERA", 2]] },
  { name: "D&T workshop", type: "CLASSROOM", capacity: 24, kit: [["DESKTOP", 4], ["PRINTER", 1]] },
];

const MAKES: Partial<Record<AssetType, [string, string][]>> = {
  DESKTOP: [["Dell", "OptiPlex 7010"], ["HP", "ProDesk 400 G9"], ["Lenovo", "ThinkCentre M70q"]],
  LAPTOP: [["Lenovo", "ThinkPad E14"], ["Dell", "Latitude 3540"]],
  CHROMEBOOK: [["Acer", "Chromebook 314"]],
  TABLET: [["Apple", "iPad (10th gen)"]],
  PRINTER: [["Kyocera", "ECOSYS M3655idn"], ["HP", "LaserJet Pro 4002"]],
  PROJECTOR: [["Epson", "EB-L210W"]],
  INTERACTIVE_DISPLAY: [["Promethean", "ActivPanel 9 75\""], ["Clevertouch", "UX Pro 2 65\""]],
  ACCESS_POINT: [["Ubiquiti", "U6 Pro"], ["Aruba", "AP-505"]],
  SWITCH: [["Aruba", "CX 6100 48G"], ["HPE", "1930 24G PoE"]],
  ROUTER: [["Draytek", "Vigor 2927"]],
  FIREWALL: [["Fortinet", "FortiGate 60F"]],
  SERVER: [["Dell", "PowerEdge R450"]],
  NAS: [["Synology", "RS1221+"]],
  UPS: [["APC", "Smart-UPS 1500"]],
  PHONE: [["Yealink", "T54W"]],
  CAMERA: [["Hikvision", "DS-2CD2143"]],
};

const PREFIX: Partial<Record<AssetType, string>> = {
  DESKTOP: "PC", LAPTOP: "LT", CHROMEBOOK: "CB", TABLET: "TB", PRINTER: "PR", PROJECTOR: "PJ",
  INTERACTIVE_DISPLAY: "IFP", ACCESS_POINT: "AP", SWITCH: "SW", ROUTER: "RT", FIREWALL: "FW",
  SERVER: "SRV", NAS: "NAS", UPS: "UPS", PHONE: "PH", CAMERA: "CAM",
};

async function main() {
  console.log("Seeding demo workspace…");

  // Remove the previous demo (cascades to everything it owns).
  await db.organisation.deleteMany({ where: { slug: DEMO_ORG_SLUG } });
  await db.user.deleteMany({ where: { email: DEMO_USER_EMAIL } });

  // The demo user can never sign in with a password (isDemo blocks it); the hash is random.
  const demoUser = await db.user.create({
    data: {
      email: DEMO_USER_EMAIL,
      name: "Demo visitor",
      isDemo: true,
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 10),
    },
  });

  const org = await db.organisation.create({
    data: { name: "Northbridge Academy Trust (demo)", slug: DEMO_ORG_SLUG, isDemo: true },
  });
  await db.membership.create({ data: { userId: demoUser.id, organisationId: org.id, role: "VIEWER" } });

  const school = await db.school.create({
    data: {
      organisationId: org.id,
      name: "Northbridge Academy",
      code: "DEMO-1001",
      phase: "Secondary",
      address: "1 Example Road, Northbridge",
      postcode: "NB1 2SV",
      phone: "01632 960000",
      contactName: "Sam Patel (Network Manager)",
      contactEmail: "it@northbridge.example",
      pupilCount: 1140,
      staffCount: 128,
      notes: "Fictional demonstration school. All names, devices and addresses are made up.",
    },
  });

  // A second, smaller school shows the multi-school dashboard.
  const primary = await db.school.create({
    data: {
      organisationId: org.id,
      name: "Northbridge Primary",
      code: "DEMO-1002",
      phase: "Primary",
      address: "14 Sample Lane, Northbridge",
      postcode: "NB3 7PQ",
      pupilCount: 410,
      staffCount: 38,
    },
  });

  // ─── Buildings, floors, rooms ──────────────────────────────────────────
  const main = await db.building.create({ data: { schoolId: school.id, name: "Main block", description: "1960s two-storey teaching block with the server room.", sortOrder: 0 } });
  const science = await db.building.create({ data: { schoolId: school.id, name: "Science & Technology block", description: "Linked to the main block by a fibre run under the courtyard.", sortOrder: 1 } });
  const mainGround = await db.floor.create({ data: { buildingId: main.id, name: "Ground floor", level: 0 } });
  const mainFirst = await db.floor.create({ data: { buildingId: main.id, name: "First floor", level: 1 } });
  const sciGround = await db.floor.create({ data: { buildingId: science.id, name: "Ground floor", level: 0 } });

  const primaryBuilding = await db.building.create({ data: { schoolId: primary.id, name: "School building", sortOrder: 0 } });
  const primaryFloor = await db.floor.create({ data: { buildingId: primaryBuilding.id, name: "Ground floor", level: 0 } });
  const PRIMARY_ROOMS: RoomSpec[] = [
    { name: "Office", type: "OFFICE", capacity: 3, kit: [["DESKTOP", 2], ["PRINTER", 1]] },
    { name: "Year 5", type: "CLASSROOM", capacity: 30, kit: [["INTERACTIVE_DISPLAY", 1], ["LAPTOP", 1], ["CHROMEBOOK", 15]] },
    { name: "Year 6", type: "CLASSROOM", capacity: 30, kit: [["INTERACTIVE_DISPLAY", 1], ["LAPTOP", 1]] },
    { name: "Comms cupboard", type: "COMMS_CABINET", kit: [["SWITCH", 1], ["ROUTER", 1], ["ACCESS_POINT", 2]] },
  ];

  const roomIds: Record<string, string> = {};
  let tagCounter = 1000;
  const assetRows: Prisma.AssetCreateManyInput[] = [];

  async function addRooms(floorId: string, schoolId: string, specs: RoomSpec[], tagPrefix: string) {
    for (const [i, spec] of specs.entries()) {
      const room = await db.room.create({
        data: {
          schoolId,
          floorId,
          name: spec.name,
          type: spec.type,
          capacity: spec.capacity,
          // 1 m = 20 map units; 11 m × 8 m rooms on a 12 m × 9 m grid.
          x: (i % 4) * 240,
          y: Math.floor(i / 4) * 180,
          width: spec.type === "COMMS_CABINET" || spec.type === "SERVER_ROOM" ? 120 : 220,
          height: spec.type === "COMMS_CABINET" ? 100 : 160,
        },
      });
      roomIds[`${schoolId}:${spec.name}`] = room.id;

      for (const [type, count] of spec.kit) {
        for (let n = 0; n < count; n++) {
          const [manufacturer, model] = pick(MAKES[type] ?? [["Generic", "Device"]]);
          const purchaseDaysAgo = Math.floor(200 + rand() * 1700);
          // Warranties: mostly fine, some expiring soon, some already expired.
          const roll = rand();
          const warrantyDays = roll < 0.12 ? -Math.floor(rand() * 200) - 1 : roll < 0.25 ? Math.floor(rand() * 85) + 3 : Math.floor(120 + rand() * 900);
          tagCounter += 1;
          const tag = `${tagPrefix}-${PREFIX[type] ?? "AS"}-${tagCounter}`;
          const status: AssetStatus = rand() < 0.04 ? "IN_REPAIR" : rand() < 0.03 ? "IN_STORAGE" : "ACTIVE";
          assetRows.push({
            organisationId: org.id,
            schoolId,
            roomId: room.id,
            type,
            name: `${spec.name.replace(/^([A-Z]\d+) .*/, "$1")} ${PREFIX[type] ?? type} ${n + 1}`.trim(),
            assetTag: tag,
            manufacturer,
            model,
            serialNumber: `SN${Math.floor(rand() * 1e10).toString(36).toUpperCase()}`,
            ipAddress: ["DESKTOP", "PRINTER", "SERVER", "SWITCH", "ACCESS_POINT", "NAS", "FIREWALL", "ROUTER", "CAMERA"].includes(type)
              ? `10.${schoolId === school.id ? 20 : 30}.${Math.floor(rand() * 8)}.${10 + Math.floor(rand() * 240)}`
              : null,
            assignedTo: type === "LAPTOP" ? pick(["J. Okafor", "R. Singh", "L. Hughes", "M. Byrne"]) : null,
            status,
            purchaseDate: daysFromNow(-purchaseDaysAgo),
            warrantyExpiry: daysFromNow(warrantyDays),
            purchaseCost: Math.round((type === "SERVER" ? 4200 : type === "INTERACTIVE_DISPLAY" ? 2600 : 180 + rand() * 900) * 100) / 100,
          });
        }
      }
    }
  }

  await addRooms(mainGround.id, school.id, MAIN_GROUND, "NBA");
  await addRooms(mainFirst.id, school.id, MAIN_FIRST, "NBA");
  await addRooms(sciGround.id, school.id, SCIENCE_GROUND, "NBA");
  await addRooms(primaryFloor.id, primary.id, PRIMARY_ROOMS, "NBP");
  await db.asset.createMany({ data: assetRows });

  const assets = await db.asset.findMany({ where: { organisationId: org.id }, select: { id: true, type: true, roomId: true, name: true, schoolId: true } });
  const assetIn = (roomName: string, type: AssetType, schoolId = school.id) =>
    assets.find((a) => a.roomId === roomIds[`${schoolId}:${roomName}`] && a.type === type);

  // ─── Cabinets: rack the server-room and comms-room kit ─────────────────
  async function cabinetFor(roomName: string, tag: string, name: string, size: number, mounts: { type: AssetType; u: number; height: number }[], extras: { name: string; u: number; height: number }[] = []) {
    const roomId = roomIds[`${school.id}:${roomName}`]!;
    const cabinet = await db.asset.create({
      data: {
        organisationId: org.id, schoolId: school.id, roomId, type: "CABINET", name, assetTag: tag,
        manufacturer: "APC", model: `NetShelter SX ${size}U`, rackUnits: size, status: "ACTIVE",
      },
    });
    const used = new Set<string>();
    for (const m of mounts) {
      const asset = assets.find((a) => a.roomId === roomId && a.type === m.type && !used.has(a.id));
      if (!asset) continue;
      used.add(asset.id);
      await db.asset.update({ where: { id: asset.id }, data: { cabinetId: cabinet.id, rackPosition: m.u, rackUnits: m.height } });
    }
    for (const [i, e] of extras.entries()) {
      await db.asset.create({
        data: {
          organisationId: org.id, schoolId: school.id, roomId, cabinetId: cabinet.id, type: "OTHER", name: e.name,
          assetTag: `${tag}-PP${i + 1}`, manufacturer: "Excel", model: "Cat6a 24-port patch panel", rackPosition: e.u, rackUnits: e.height,
        },
      });
    }
  }
  await cabinetFor("Server room", "NBA-CAB-01", "Core cabinet", 42, [
    { type: "ROUTER", u: 40, height: 1 },
    { type: "FIREWALL", u: 38, height: 1 },
    { type: "SWITCH", u: 35, height: 1 },
    { type: "SERVER", u: 28, height: 2 },
    { type: "SERVER", u: 25, height: 2 },
    { type: "NAS", u: 20, height: 2 },
    { type: "UPS", u: 1, height: 3 },
  ], [
    { name: "Patch panel A", u: 37, height: 1 },
    { name: "Patch panel B", u: 34, height: 1 },
  ]);
  await cabinetFor("Comms cabinet F1", "NBA-CAB-02", "First floor cabinet", 12, [
    { type: "SWITCH", u: 9, height: 1 },
    { type: "UPS", u: 1, height: 2 },
  ], [{ name: "Patch panel F1", u: 10, height: 1 }]);
  await cabinetFor("Comms cabinet S", "NBA-CAB-03", "Science block cabinet", 24, [{ type: "SWITCH", u: 18, height: 1 }], [
    { name: "Fibre patch panel", u: 20, height: 1 },
    { name: "Patch panel S", u: 19, height: 1 },
  ]);

  // ─── Stairs (same position on each floor so they line up) and a lift ────
  for (const floorId of [mainGround.id, mainFirst.id, sciGround.id]) {
    await db.room.create({ data: { schoolId: school.id, floorId, name: "Stairs A", type: "STAIRS", x: 720, y: 180, width: 60, height: 120 } });
  }
  for (const floorId of [mainGround.id, mainFirst.id]) {
    await db.room.create({ data: { schoolId: school.id, floorId, name: "Lift", type: "LIFT", x: 800, y: 180, width: 60, height: 60 } });
  }

  // ─── A Chromebook trolley in the biology lab ──────────────────────────
  {
    const labId = roomIds[`${school.id}:S01 Biology lab`]!;
    const trolley = await db.asset.create({
      data: {
        organisationId: org.id, schoolId: school.id, roomId: labId, type: "TROLLEY", name: "Science Chromebook trolley",
        assetTag: "NBA-TRL-01", manufacturer: "LocknCharge", model: "Carrier 30", rackUnits: 30, status: "ACTIVE",
      },
    });
    await db.asset.updateMany({ where: { organisationId: org.id, roomId: labId, type: "CHROMEBOOK" }, data: { cabinetId: trolley.id } });
  }

  // ─── Network ────────────────────────────────────────────────────────────
  type NodeSpec = { key: string; type: NetworkNodeType; label: string; x: number; y: number; users?: number; crit?: number; room?: string; assetType?: AssetType };
  const nodes: NodeSpec[] = [
    { key: "isp", type: "INTERNET", label: "Internet (fibre leased line)", x: 380, y: 0, crit: 5 },
    { key: "lte", type: "WAN_LINK", label: "4G backup link", x: 640, y: 0, crit: 3 },
    { key: "router", type: "ROUTER", label: "Edge router", x: 500, y: 110, crit: 5, room: "Server room", assetType: "ROUTER" },
    { key: "fw", type: "FIREWALL", label: "FortiGate firewall", x: 500, y: 220, crit: 5, room: "Server room", assetType: "FIREWALL" },
    { key: "core", type: "CORE_SWITCH", label: "Core switch", x: 500, y: 330, crit: 5, room: "Server room", assetType: "SWITCH" },
    { key: "sw-f1", type: "SWITCH", label: "SW-F1 First floor", x: 200, y: 460, users: 130, crit: 4, room: "Comms cabinet F1", assetType: "SWITCH" },
    { key: "sw-sci", type: "SWITCH", label: "SW-S Science block", x: 500, y: 460, users: 140, crit: 4, room: "Comms cabinet S", assetType: "SWITCH" },
    { key: "srv1", type: "SERVER", label: "SRV-01 Hyper-V host", x: 820, y: 400, crit: 5, room: "Server room", assetType: "SERVER" },
    { key: "nas", type: "SERVER", label: "Backup NAS", x: 820, y: 520, crit: 3, room: "Server room", assetType: "NAS" },
    { key: "ap-hall", type: "ACCESS_POINT", label: "AP Main hall", x: 80, y: 600, users: 200, crit: 2, room: "Main hall", assetType: "ACCESS_POINT" },
    { key: "ap-lib", type: "ACCESS_POINT", label: "AP Library", x: 260, y: 600, users: 60, crit: 2, room: "Library", assetType: "ACCESS_POINT" },
    { key: "ap-sci", type: "ACCESS_POINT", label: "AP Science", x: 500, y: 600, users: 90, crit: 3, room: "Comms cabinet S", assetType: "ACCESS_POINT" },
    { key: "mis", type: "SERVICE", label: "MIS & registers", x: 740, y: 680, users: 128, crit: 5 },
    { key: "files", type: "SERVICE", label: "File shares", x: 900, y: 680, users: 1268, crit: 4 },
    { key: "print", type: "SERVICE", label: "Print service", x: 1060, y: 520, users: 160, crit: 2 },
    { key: "wifi", type: "SERVICE", label: "Staff & pupil Wi-Fi", x: 300, y: 740, users: 900, crit: 4 },
    { key: "voip", type: "SERVICE", label: "Telephony", x: 120, y: 740, users: 60, crit: 4 },
  ];
  const nodeIds: Record<string, string> = {};
  for (const n of nodes) {
    const created = await db.networkNode.create({
      data: {
        organisationId: org.id,
        schoolId: school.id,
        type: n.type,
        label: n.label,
        posX: n.x,
        posY: n.y,
        usersServed: n.users ?? 0,
        criticality: n.crit ?? 3,
        roomId: n.room ? roomIds[`${school.id}:${n.room}`] : null,
        assetId: n.room && n.assetType ? assetIn(n.room, n.assetType)?.id ?? null : null,
      },
    });
    nodeIds[n.key] = created.id;
  }
  const links: [string, string, LinkKind?][] = [
    ["isp", "router"],
    ["lte", "router", "REDUNDANT"],
    ["router", "fw"],
    ["fw", "core"],
    ["core", "sw-f1"],
    ["core", "sw-sci"],
    ["core", "srv1"],
    ["core", "nas"],
    ["core", "ap-hall"],
    ["sw-f1", "ap-lib"],
    ["sw-sci", "ap-sci"],
    ["srv1", "mis"],
    ["srv1", "files"],
    ["nas", "files", "REDUNDANT"],
    ["srv1", "print"],
    ["ap-hall", "wifi"],
    ["ap-lib", "wifi", "REDUNDANT"],
    ["ap-sci", "wifi", "REDUNDANT"],
    ["fw", "voip"],
  ];
  await db.networkLink.createMany({
    data: links.map(([s, t, kind]) => ({ schoolId: school.id, sourceId: nodeIds[s]!, targetId: nodeIds[t]!, kind: kind ?? "PRIMARY" })),
  });

  // ─── Cable runs ─────────────────────────────────────────────────────────
  // Paths follow the demo room grid (rooms 11 m x 8 m on a 12 m x 9 m pitch; 20 units = 1 m).
  const roomCentre = (schoolId: string, name: string) => {
    const r = demoRooms.find((x) => x.id === roomIds[`${schoolId}:${name}`])!;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  };
  const demoRooms = await db.room.findMany({ where: { schoolId: school.id }, select: { id: true, x: true, y: true, width: true, height: true, floorId: true } });
  const corridorY = 170; // the gap between the first and second rows of rooms
  const runs: { floorId: string; name: string; type: "CAT5E" | "CAT6" | "CAT6A" | "FIBRE_SM" | "FIBRE_MM"; path: { x: number; y: number }[]; notes?: string }[] = [
    {
      floorId: mainGround.id,
      name: "Server room to Library",
      type: "CAT6A",
      path: [roomCentre(school.id, "Server room"), { x: roomCentre(school.id, "Server room").x, y: corridorY }, { x: roomCentre(school.id, "Library").x, y: corridorY }, roomCentre(school.id, "Library")],
      notes: "Patch panel A, ports 1-12",
    },
    {
      floorId: mainGround.id,
      name: "Server room to Reception",
      type: "CAT6",
      path: [roomCentre(school.id, "Server room"), { x: roomCentre(school.id, "Server room").x, y: corridorY }, { x: roomCentre(school.id, "Reception").x, y: corridorY }, roomCentre(school.id, "Reception")],
    },
    {
      floorId: mainGround.id,
      name: "Staffroom drop (legacy)",
      type: "CAT5E",
      path: [{ x: roomCentre(school.id, "Server room").x, y: corridorY }, { x: roomCentre(school.id, "Staffroom").x, y: corridorY }, roomCentre(school.id, "Staffroom")],
      notes: "Due for replacement with Cat6a",
    },
    {
      floorId: sciGround.id,
      name: "Fibre backbone to science block",
      type: "FIBRE_MM",
      path: [{ x: 960, y: corridorY }, { x: roomCentre(school.id, "Comms cabinet S").x, y: corridorY }, roomCentre(school.id, "Comms cabinet S")],
      notes: "OM4, 12 core. Enters from the courtyard duct.",
    },
    {
      floorId: sciGround.id,
      name: "Comms S to Biology lab",
      type: "CAT6",
      path: [roomCentre(school.id, "Comms cabinet S"), { x: roomCentre(school.id, "Comms cabinet S").x, y: corridorY }, { x: roomCentre(school.id, "S01 Biology lab").x, y: corridorY }, roomCentre(school.id, "S01 Biology lab")],
    },
  ];
  const len = (p: { x: number; y: number }[]) => Math.round((p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i]!.x, q.y - p[i]!.y), 0) / 20) * 10) / 10;
  for (const run of runs) {
    await db.cableRun.create({
      data: {
        organisationId: org.id,
        schoolId: school.id,
        floorId: run.floorId,
        name: run.name,
        type: run.type,
        points: run.path,
        lengthMetres: len(run.path),
        notes: run.notes,
      },
    });
  }

  // ─── Faults ─────────────────────────────────────────────────────────────
  type FaultSpec = { title: string; description: string; priority: FaultPriority; status: FaultStatus; room: string; type?: AssetType; daysAgo: number; resolution?: string; schoolId?: string };
  const faults: FaultSpec[] = [
    { title: "Interactive display won't wake from standby", description: "Panel stays black; power LED amber. Tried the remote and a hard reset.", priority: "HIGH", status: "OPEN", room: "F02 Maths", type: "INTERACTIVE_DISPLAY", daysAgo: 1 },
    { title: "Science block Wi-Fi drops during lessons", description: "Chromebooks lose connection every 10–15 minutes in S01.", priority: "CRITICAL", status: "IN_PROGRESS", room: "S01 Biology lab", type: "CHROMEBOOK", daysAgo: 2 },
    { title: "Printer jamming on duplex", description: "Paper jams on every double-sided job.", priority: "MEDIUM", status: "OPEN", room: "Staffroom", type: "PRINTER", daysAgo: 4 },
    { title: "Projector bulb flickering", description: "Image dims and flickers after ~20 minutes.", priority: "LOW", status: "ON_HOLD", room: "S03 Physics lab", type: "PROJECTOR", daysAgo: 9 },
    { title: "UPS reporting battery fault", description: "Self-test failed overnight; runtime estimate 3 minutes.", priority: "HIGH", status: "OPEN", room: "Server room", type: "UPS", daysAgo: 3 },
    { title: "Two IT suite PCs won't log in", description: "Domain trust relationship failed on PC 3 and PC 7.", priority: "MEDIUM", status: "RESOLVED", room: "F01 IT suite", type: "DESKTOP", daysAgo: 12, resolution: "Rejoined both machines to the domain and reset computer accounts." },
    { title: "Reception phone has no dial tone", description: "Handset boots but shows 'No service'.", priority: "MEDIUM", status: "CLOSED", room: "Reception", type: "PHONE", daysAgo: 20, resolution: "Replaced faulty patch lead at the comms cabinet." },
    { title: "Year 5 display has no sound", description: "HDMI audio not coming through from the laptop.", priority: "LOW", status: "OPEN", room: "Year 5", type: "INTERACTIVE_DISPLAY", daysAgo: 5, schoolId: primary.id },
  ];
  for (const f of faults) {
    const schoolId = f.schoolId ?? school.id;
    const created = await db.fault.create({
      data: {
        organisationId: org.id,
        schoolId,
        roomId: roomIds[`${schoolId}:${f.room}`],
        assetId: f.type ? assetIn(f.room, f.type, schoolId)?.id ?? null : null,
        title: f.title,
        description: f.description,
        priority: f.priority,
        status: f.status,
        resolution: f.resolution,
        resolvedAt: f.resolution ? daysFromNow(-f.daysAgo + 2) : null,
        createdAt: daysFromNow(-f.daysAgo),
      },
    });
    if (f.status !== "OPEN") {
      await db.faultUpdate.create({
        data: {
          faultId: created.id,
          kind: f.resolution ? "FIX" : "STATUS_CHANGE",
          message: f.resolution ?? "Investigating with the supplier.",
          fromStatus: "OPEN",
          toStatus: f.status,
          createdAt: daysFromNow(-f.daysAgo + 1),
        },
      });
    }
  }

  // ─── Activity ───────────────────────────────────────────────────────────
  const activity = [
    { summary: "Sam Patel added the Science Chromebook trolley with 8 Chromebooks", days: 2 },
    { summary: "Sam Patel mapped the fibre backbone to the science block", days: 10 },
    { summary: "Priya Shah imported 64 assets for Northbridge Academy", days: 30 },
    { summary: "Priya Shah added Northbridge Primary", days: 31 },
    { summary: "Priya Shah created the Northbridge Academy Trust workspace", days: 32 },
  ];
  await db.auditLog.createMany({
    data: activity.map((a) => ({
      organisationId: org.id,
      action: "demo.seed",
      entityType: "demo",
      summary: a.summary,
      createdAt: daysFromNow(-a.days),
    })),
  });

  console.log(`Demo ready: ${assetRows.length} assets, ${nodes.length} network components, ${faults.length} faults.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
