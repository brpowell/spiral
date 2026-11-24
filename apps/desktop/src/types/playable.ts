import type { TrackId } from "./track";

export type PlayableRef =
  | { type: "library"; trackId: TrackId }
  | { type: "cd"; driveId: string; trackNumber: number };
