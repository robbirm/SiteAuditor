import { z } from "zod";

const trimmed = (max: number) => z.string().trim().max(max);
/** Empty form fields become null rather than "". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const optionalInt = (min: number, max: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Enter a whole number between ${min} and ${max}.` });
        return z.NEVER;
      }
      return n;
    });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use 128 characters or fewer.")
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), "Include at least one letter and one number.");

export const registerSchema = z.object({
  name: trimmed(80).min(2, "Enter your name."),
  email: emailSchema,
  password: passwordSchema,
  organisationName: trimmed(80).min(2, "Enter your organisation or school name."),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const organisationSchema = z.object({
  organisationName: trimmed(80).min(2, "Enter an organisation name."),
});

export const schoolSchema = z.object({
  name: trimmed(120).min(2, "Enter the school name."),
  code: optionalText(32),
  phase: optionalText(40),
  address: optionalText(240),
  postcode: optionalText(12),
  phone: optionalText(32),
  contactName: optionalText(80),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email address."),
  pupilCount: optionalInt(0, 20000),
  staffCount: optionalInt(0, 5000),
  notes: optionalText(2000),
});

export const buildingSchema = z.object({
  name: trimmed(80).min(1, "Enter a building name."),
  description: optionalText(400),
});

export const floorSchema = z.object({
  name: trimmed(60).min(1, "Enter a floor name."),
  level: optionalInt(-5, 100).transform((v) => v ?? 0),
});

export const ROOM_TYPES = [
  "CLASSROOM",
  "OFFICE",
  "IT_SUITE",
  "SERVER_ROOM",
  "COMMS_CABINET",
  "HALL",
  "LIBRARY",
  "STAFFROOM",
  "CORRIDOR",
  "STAIRS",
  "LIFT",
  "OTHER",
] as const;

export const roomSchema = z.object({
  name: trimmed(80).min(1, "Enter a room name."),
  type: z.enum(ROOM_TYPES),
  capacity: optionalInt(0, 2000),
});

export const ROLES = ["OWNER", "ADMIN", "TECHNICIAN", "VIEWER"] as const;

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES),
});

export const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "Invalid id.");

/** FormData → plain object (single values only). */
export function formToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string().max(128) })
  .refine((v) => v.password === v.confirmPassword, { message: "The passwords don't match.", path: ["confirmPassword"] });

export const profileSchema = z.object({
  name: trimmed(80).min(2, "Enter your name."),
  email: emailSchema,
  currentPassword: z.string().max(128).optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string().max(128),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "The passwords don't match.", path: ["confirmPassword"] });

// ─── Assets ───────────────────────────────────────────────────────────────

export const ASSET_TYPES = [
  "DESKTOP",
  "LAPTOP",
  "CHROMEBOOK",
  "TABLET",
  "PRINTER",
  "PROJECTOR",
  "INTERACTIVE_DISPLAY",
  "ACCESS_POINT",
  "SWITCH",
  "ROUTER",
  "FIREWALL",
  "SERVER",
  "NAS",
  "UPS",
  "PHONE",
  "CAMERA",
  "CABINET",
  "TROLLEY",
  "OTHER",
] as const;

export const ASSET_STATUSES = ["ACTIVE", "IN_REPAIR", "IN_STORAGE", "RETIRED"] as const;

const optionalDate = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(`${v}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date." });
      return z.NEVER;
    }
    return d;
  });

export const assetSchema = z.object({
  schoolId: z.string().min(1, "Choose a school.").max(64),
  roomId: optionalText(64),
  type: z.enum(ASSET_TYPES),
  name: trimmed(120).min(1, "Give the device a name."),
  assetTag: optionalText(40),
  manufacturer: optionalText(80),
  model: optionalText(80),
  serialNumber: optionalText(80),
  ipAddress: optionalText(45).refine(
    (v) => v === null || /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || /^[0-9a-fA-F:]+$/.test(v),
    "Enter an IPv4 or IPv6 address.",
  ),
  macAddress: optionalText(32),
  assignedTo: optionalText(80),
  status: z.enum(ASSET_STATUSES),
  purchaseDate: optionalDate,
  warrantyExpiry: optionalDate,
  notes: optionalText(2000),
  cabinetId: optionalText(64),
  rackPosition: optionalInt(1, 60),
  rackUnits: optionalInt(1, 60),
});

export const assetPositionSchema = z.object({
  assetId: idSchema,
  floorId: idSchema,
  mapX: z.number().finite().min(-20000).max(20000),
  mapY: z.number().finite().min(-20000).max(20000),
});

// ─── Floor map geometry ───────────────────────────────────────────────────
// Map units: 20 units = 1 metre. Rooms snap to whole metres.

export const MAP_UNITS_PER_METRE = 20;

export const roomGeometrySchema = z.object({
  roomId: idSchema,
  x: z.number().int().min(-20000).max(20000),
  y: z.number().int().min(-20000).max(20000),
  width: z.number().int().min(2 * 20).max(200 * 20),
  height: z.number().int().min(2 * 20).max(200 * 20),
});

export const mapRoomSchema = z.object({
  name: trimmed(80).min(1, "Enter a room name."),
  type: z.enum(ROOM_TYPES),
  widthM: z.coerce.number().int().min(2).max(200),
  depthM: z.coerce.number().int().min(2).max(200),
});

// ─── Cable runs ───────────────────────────────────────────────────────────

export const CABLE_TYPE_VALUES = ["CAT5E", "CAT6", "CAT6A", "CAT7", "FIBRE_SM", "FIBRE_MM", "COAX", "OTHER"] as const;

const cablePoints = z
  .array(z.object({ x: z.number().finite().min(-20000).max(20000), y: z.number().finite().min(-20000).max(20000) }))
  .min(2, "A cable run needs at least two points.")
  .max(200, "That cable run has too many points.");

export const cableRunCreateSchema = z.object({
  floorId: idSchema,
  name: trimmed(80).min(1, "Give the run a name."),
  type: z.enum(CABLE_TYPE_VALUES),
  notes: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  points: cablePoints,
});

export const cableRunMetaSchema = z.object({
  name: trimmed(80).min(1, "Give the run a name."),
  type: z.enum(CABLE_TYPE_VALUES),
  notes: optionalText(1000),
});

export const cableRunPointsSchema = z.object({ cableRunId: idSchema, points: cablePoints });
