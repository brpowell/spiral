export type PlaylistImageMode = "generated" | "design" | "custom";

export interface Playlist {
  id: number;
  title: string;
  description: string | null;
  dateCreated: string;
  lastUsedAt: string;
  trackIds: number[];
  imageMode: PlaylistImageMode;
  customImagePath: string | null;
  /** Solid fill or gradient start (`#rrggbb`). Used when `imageMode` is `design`. */
  coverBackground: string | null;
  /** Gradient end (`#rrggbb`). Null means solid. */
  coverBackgroundEnd: string | null;
  /** Cover icon id from the designed-cover catalog. */
  coverIcon: string | null;
}
