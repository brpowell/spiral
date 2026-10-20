export type PackZone = "builtin" | "installed" | "linked";

/** Linked items (the Library's Packs folder and linked folders) are the mutable authoring class. */
export function isAuthoringPackZone(zone: PackZone): boolean {
  return zone === "linked";
}

/**
 * Whether Studio edits items in this zone in place. Dev builds also edit built-ins, whose
 * root is the live source tree, so token tweaks can be committed. Mirrors Rust
 * `PackZone::is_editable`, which enforces it; release builds never edit built-ins.
 */
export function isEditablePackZone(zone: PackZone): boolean {
  return (
    isAuthoringPackZone(zone) || (import.meta.env.DEV && zone === "builtin")
  );
}
