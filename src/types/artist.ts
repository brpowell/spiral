import type { Track } from "./track";

export interface Artist {
  key: string;
  name: string;
  artPath: string | null;
  tracks: Track[];
}
