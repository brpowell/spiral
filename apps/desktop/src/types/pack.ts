export type PackZone = "builtin" | "workshop" | "installed" | "linked";

/** Workshop drafts and linked folders share the mutable authoring class. */
export function isAuthoringPackZone(zone: PackZone): boolean {
  return zone === "workshop" || zone === "linked";
}
