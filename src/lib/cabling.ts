// Cable types, labels and colours. Shared by server and client code.

export const CABLE_TYPES = ["CAT5E", "CAT6", "CAT6A", "CAT7", "FIBRE_SM", "FIBRE_MM", "COAX", "OTHER"] as const;
export type CableTypeValue = (typeof CABLE_TYPES)[number];

export const CABLE_LABELS: Record<string, string> = {
  CAT5E: "Cat5e",
  CAT6: "Cat6",
  CAT6A: "Cat6a",
  CAT7: "Cat7",
  FIBRE_SM: "Fibre, single-mode",
  FIBRE_MM: "Fibre, multimode (OM3/OM4)",
  COAX: "Coax",
  OTHER: "Other",
};

export const CABLE_SHORT_LABELS: Record<string, string> = {
  CAT5E: "Cat5e",
  CAT6: "Cat6",
  CAT6A: "Cat6a",
  CAT7: "Cat7",
  FIBRE_SM: "Fibre SM",
  FIBRE_MM: "Fibre MM",
  COAX: "Coax",
  OTHER: "Other",
};

/** Colours follow common patch-lead conventions where there is one (yellow SM, aqua OM3/4). */
export const CABLE_COLOURS: Record<string, string> = {
  CAT5E: "#A3B1C2",
  CAT6: "#5BA8F5",
  CAT6A: "#3DD68C",
  CAT7: "#9B8CF5",
  FIBRE_SM: "#FACC15",
  FIBRE_MM: "#22D3EE",
  COAX: "#F59E6B",
  OTHER: "#E58FD0",
};

export const isFibre = (type: string) => type === "FIBRE_SM" || type === "FIBRE_MM";

export type CablePoint = { x: number; y: number };

/** Length of a path in metres (20 map units = 1 m), to one decimal place. */
export function pathLengthMetres(points: CablePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return Math.round((total / 20) * 10) / 10;
}
