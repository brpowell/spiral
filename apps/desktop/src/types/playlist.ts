import type { TrackId } from "./track";

export type PlaylistImageMode = "generated" | "design" | "custom";

/** A playlist's id: a UUIDv7 string. */
export type PlaylistId = string;

export interface Playlist {
  id: PlaylistId;
  title: string;
  description: string | null;
  dateCreated: string;
  lastUsedAt: string;
  trackIds: TrackId[];
  imageMode: PlaylistImageMode;
  customImagePath: string | null;
  /** Solid fill or gradient start (`#rrggbb`). Used when `imageMode` is `design`. */
  coverBackground: string | null;
  /** Gradient end (`#rrggbb`). Null means solid. */
  coverBackgroundEnd: string | null;
  /** Cover icon id from the designed-cover catalog. */
  coverIcon: string | null;
}
