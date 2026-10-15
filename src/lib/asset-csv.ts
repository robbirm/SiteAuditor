// The asset CSV format: columns, examples and value normalisers. Shared by the
// template, export and import so a downloaded file can always be re-imported.
import { ASSET_STATUS_LABELS, ASSET_TYPE_LABELS } from "./labels";

export const ASSET_CSV_COLUMNS = [
  { key: "school", header: "school", required: true, help: "School name, exactly as in SchoolVerse" },
  { key: "building", header: "building", help: "Optional. Helps find the room if names repeat" },
  { key: "floor", header: "floor", help: "Optional. Helps find the room if names repeat" },
  { key: "room", header: "room", help: "Room name. Leave blank if it isn't in a room yet" },
  { key: "type", header: "type", required: true, help: "e.g. Desktop, Laptop, Access point, Switch, Server cabinet" },
  { key: "name", header: "name", required: true, help: "What people call it, e.g. Teacher PC" },
  { key: "assetTag", header: "asset_tag", help: "Leave blank to generate. Rows with an existing tag update that device" },
  { key: "manufacturer", header: "manufacturer" },
  { key: "model", header: "model" },
  { key: "serialNumber", header: "serial_number" },
  { key: "ipAddress", header: "ip_address" },
  { key: "macAddress", header: "mac_address" },
  { key: "assignedTo", header: "assigned_to" },
  { key: "status", header: "status", help: "In use, In repair, In storage or Retired (default In use)" },
  { key: "purchaseDate", header: "purchase_date", help: "YYYY-MM-DD or DD/MM/YYYY" },
  { key: "warrantyExpiry", header: "warranty_expiry", help: "YYYY-MM-DD or DD/MM/YYYY" },
  { key: "cabinet", header: "stored_in", help: "Asset tag or name of the server cabinet or trolley it's kept in" },
  { key: "rackPosition", header: "rack_position_u", help: "Cabinets only: lowest U it occupies, e.g. 38" },
  { key: "rackUnits", header: "rack_units", help: "Height in U; for a cabinet its total U, for a trolley its number of bays" },
  { key: "notes", header: "notes" },
] as const;

export type AssetCsvKey = (typeof ASSET_CSV_COLUMNS)[number]["key"];
export type AssetCsvRow = Partial<Record<AssetCsvKey, string>>;

const norm = (v: string) => v.trim().toLowerCase().replace(/[\s_\-/]+/g, " ");

/** Accepts "Access point", "ACCESS_POINT", "access-point", "AP" and similar. */
export function parseAssetType(value: string): string | null {
  const v = norm(value);
  if (!v) return null;
  const aliases: Record<string, string> = {
    pc: "DESKTOP", computer: "DESKTOP", workstation: "DESKTOP", notebook: "LAPTOP", ipad: "TABLET",
    ap: "ACCESS_POINT", "wifi ap": "ACCESS_POINT", "wireless access point": "ACCESS_POINT", wap: "ACCESS_POINT",
    ifp: "INTERACTIVE_DISPLAY", "interactive whiteboard": "INTERACTIVE_DISPLAY", "smart board": "INTERACTIVE_DISPLAY", display: "INTERACTIVE_DISPLAY",
    cabinet: "CABINET", rack: "CABINET", "comms cabinet": "CABINET", "network cabinet": "CABINET",
    trolley: "TROLLEY", cart: "TROLLEY", "laptop trolley": "TROLLEY", "ipad trolley": "TROLLEY", "charging cart": "TROLLEY", "charging trolley": "TROLLEY",
    "patch panel": "OTHER", phone: "PHONE", voip: "PHONE", cctv: "CAMERA",
  };
  if (aliases[v]) return aliases[v]!;
  for (const [key, label] of Object.entries(ASSET_TYPE_LABELS)) {
    if (norm(key) === v || norm(label) === v) return key;
  }
  return null;
}

export function parseAssetStatus(value: string): string | null {
  const v = norm(value);
  if (!v) return "ACTIVE";
  const aliases: Record<string, string> = { active: "ACTIVE", live: "ACTIVE", repair: "IN_REPAIR", broken: "IN_REPAIR", storage: "IN_STORAGE", spare: "IN_STORAGE", disposed: "RETIRED" };
  if (aliases[v]) return aliases[v]!;
  for (const [key, label] of Object.entries(ASSET_STATUS_LABELS)) {
    if (norm(key) === v || norm(label) === v) return key;
  }
  return null;
}

/** Returns YYYY-MM-DD, or null for blank, or "invalid". UK day-first for slashed dates. */
export function parseCsvDate(value: string): string | null | "invalid" {
  const v = value.trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  let y: number, mo: number, d: number;
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(v))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  } else return "invalid";
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return "invalid";
  return date.toISOString().slice(0, 10);
}

/** Maps a parsed CSV (first row = headers) to keyed rows. Unknown columns are ignored. */
export function mapCsvRows(table: string[][]): { rows: AssetCsvRow[]; missing: string[]; unknown: string[] } {
  const [header = [], ...body] = table;
  const index = new Map<string, number>();
  header.forEach((h, i) => index.set(norm(h).replace(/ /g, "_"), i));
  // Older files used "cabinet" for the stored-in column.
  const ALIASES: Record<string, string[]> = { stored_in: ["cabinet", "trolley", "container"] };
  const lookup = (h: string) =>
    index.get(h) ?? index.get(h.replace(/_u$/, "")) ?? (ALIASES[h] ?? []).map((a) => index.get(a)).find((i) => i !== undefined);
  const known = new Set<string>(ASSET_CSV_COLUMNS.map((c) => c.header));
  const aliasNames = new Set(Object.values(ALIASES).flat());
  const unknown = header.filter((h) => {
    const k = norm(h).replace(/ /g, "_");
    return h.trim() && !known.has(k) && !known.has(`${k}_u`) && !aliasNames.has(k);
  });
  const missing = ASSET_CSV_COLUMNS.filter((c) => "required" in c && c.required && lookup(c.header) === undefined).map((c) => c.header);
  const rows = body.map((cells) => {
    const row: AssetCsvRow = {};
    for (const c of ASSET_CSV_COLUMNS) {
      const i = lookup(c.header);
      if (i !== undefined) row[c.key] = (cells[i] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
    }
    return row;
  });
  return { rows, missing, unknown };
}
