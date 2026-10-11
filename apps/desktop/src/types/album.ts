import type { Track } from "./track";

export interface Album {
  key: string;
  title: string;
  artist: string;
  year: number | null;
  artPath: string | null;
  tracks: Track[];
}
