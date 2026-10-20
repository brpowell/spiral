import { isEditablePackZone, type PackZone } from "./pack";

/** Mirrors Rust `CONTRIBUTION_TYPE_FOLDERS` types. */
export type ItemType = "theme" | "skin" | "visualizer" | "sound";

/** Every item type, in the order the UI lists them. */
export const ITEM_TYPES: ItemType[] = ["theme", "skin", "visualizer", "sound"];

/** Folder names under each zone root, keyed by type (`<zone>/<folder>/<publisherId>.<id>/`). */
export const ITEM_TYPE_FOLDERS: Record<ItemType, string> = {
  theme: "themes",
  skin: "skins",
  visualizer: "visualizers",
  sound: "sounds",
};

/** Mirrors Rust `ItemSummary` (one theme, skin, visualizer or sound on disk). */
export interface ItemSummary {
  type: ItemType;
  /** Declared item id (kebab slug). */
  id: string;
  /** Structured maintainer/distributor slug. */
  publisherId: string;
  /** `publisherId.type.id`. */
  effectiveId: string;
  version: string;
  name: string;
  description: string;
  /** Freeform credit from the manifest (may be empty). */
  author: string;
  /** Declared preview image path relative to `dir`. */
  preview?: string;
  zone: PackZone;
  dir: string;
  /** True when this directory wins in the scan registry for its effective id. */
  active: boolean;
}

/** Linked items are editable in place, and built-ins in dev builds. */
export function isEditableItem(item: Pick<ItemSummary, "zone">): boolean {
  return isEditablePackZone(item.zone);
}
