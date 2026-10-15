import type { Role } from "@prisma/client";

/**
 * Central permission matrix. Every server action and route handler asks for a
 * permission rather than checking roles directly, so the matrix is the single
 * source of truth as the product grows.
 */
export const PERMISSIONS = {
  "org:read": ["OWNER", "ADMIN", "TECHNICIAN", "VIEWER"],
  "org:update": ["OWNER", "ADMIN"],
  "org:delete": ["OWNER"],
  "member:manage": ["OWNER", "ADMIN"],
  "school:create": ["OWNER", "ADMIN"],
  "school:update": ["OWNER", "ADMIN"],
  "school:delete": ["OWNER", "ADMIN"],
  "structure:manage": ["OWNER", "ADMIN", "TECHNICIAN"],
  "asset:write": ["OWNER", "ADMIN", "TECHNICIAN"],
  "asset:delete": ["OWNER", "ADMIN"],
  "fault:write": ["OWNER", "ADMIN", "TECHNICIAN"],
  "network:write": ["OWNER", "ADMIN", "TECHNICIAN"],
  "simulation:run": ["OWNER", "ADMIN", "TECHNICIAN", "VIEWER"],
  "report:export": ["OWNER", "ADMIN", "TECHNICIAN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_RANK: Record<Role, number> = { OWNER: 4, ADMIN: 3, TECHNICIAN: 2, VIEWER: 1 };

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  TECHNICIAN: "Technician",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: "Full control, including billing and deleting the workspace.",
  ADMIN: "Manage schools, team members and all IT records.",
  TECHNICIAN: "Manage assets, rooms, faults and network maps.",
  VIEWER: "Read-only access to dashboards, maps and reports.",
};

/** Whether `actor` may assign or change a member to/from `target` role. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target !== "OWNER";
  return false;
}
