export type PlaylistImageMode = "generated" | "custom";

export interface Playlist {
  id: number;
  title: string;
  description: string | null;
  dateCreated: string;
  lastUsedAt: string;
  trackIds: number[];
  imageMode: PlaylistImageMode;
  customImagePath: string | null;
}
