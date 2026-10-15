// Human-readable labels for enum values. Shared by server and client code.

export const ROOM_TYPE_LABELS: Record<string, string> = {
  CLASSROOM: "Classroom",
  OFFICE: "Office",
  IT_SUITE: "IT suite",
  SERVER_ROOM: "Server room",
  COMMS_CABINET: "Comms cabinet",
  HALL: "Hall",
  LIBRARY: "Library",
  STAFFROOM: "Staffroom",
  CORRIDOR: "Corridor",
  STAIRS: "Stairs",
  LIFT: "Lift",
  OTHER: "Other",
};

export const ASSET_TYPE_LABELS: Record<string, string> = {
  DESKTOP: "Desktop",
  LAPTOP: "Laptop",
  CHROMEBOOK: "Chromebook",
  TABLET: "Tablet",
  PRINTER: "Printer",
  PROJECTOR: "Projector",
  INTERACTIVE_DISPLAY: "Interactive display",
  ACCESS_POINT: "Access point",
  SWITCH: "Switch",
  ROUTER: "Router",
  FIREWALL: "Firewall",
  SERVER: "Server",
  NAS: "NAS",
  UPS: "UPS",
  PHONE: "Phone",
  CAMERA: "Camera",
  CABINET: "Server cabinet",
  TROLLEY: "Charging trolley",
  OTHER: "Other",
};

export const ASSET_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "In use",
  IN_REPAIR: "In repair",
  IN_STORAGE: "In storage",
  RETIRED: "Retired",
};

export const FAULT_PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const FAULT_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const SCHOOL_PHASES = ["Nursery", "Primary", "Secondary", "All-through", "Special", "Sixth form", "Other"];

/** Asset types that hold other equipment. */
export const CONTAINER_TYPES = ["CABINET", "TROLLEY"] as const;
export const isContainerType = (type: string) => type === "CABINET" || type === "TROLLEY";
