export type PlayableRef =
  | { type: "library"; trackId: number }
  | { type: "cd"; driveId: string; trackNumber: number };
