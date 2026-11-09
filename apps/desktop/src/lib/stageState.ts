import type { Track } from "@/types/track";

/**
 * Portable description of a staged app state, used by the dev-only marketing
 * stage tooling (`scripts/stage.mjs`, `src/lib/stage.ts`). Nothing here refers
 * to database ids, so a scene recorded on one machine applies on another.
 */
export interface StageTrackRef {
  title: string;
  artist: string | null;
  album: string | null;
}

export type StageNav =
  | { view: "library" | "albums" | "artists" }
  | { view: "library" | "albums" | "artists"; albumKey: string }
  | { view: "library" | "albums" | "artists"; artistKey: string }
  | { view: "library" | "albums" | "artists"; playlist: string };

export interface StagePlayback {
  track: StageTrackRef | null;
  positionSeconds: number;
  state: "playing" | "paused";
  muted?: boolean;
}

export interface StageAppState {
  nav?: StageNav;
  theme?: string;
  skin?: string;
  skinView?: string;
  visualizer?: string;
  playback?: StagePlayback;
  /** `scrollTop` by CSS selector (first match of each). */
  scroll?: Record<string, number>;
  selection?: StageTrackRef[];
  /**
   * What the sidebar's Devices section (CD drives) must show before a shot. A
   * number is a minimum count, which is what `save` records: a drive's name is
   * the disc's title, so it changes with the disc. A list of names is a
   * stricter check. `apply` waits for it, since a drive can take a while to be
   * probed after launch.
   */
  devices?: number | string[];
}

export const STAGE_SCROLL_SELECTORS = [
  ".main-content",
  ".track-list__scroll",
  ".sidebar__playlist-list",
] as const;

export const STAGE_DEVICE_SELECTOR = ".sidebar__device-list li";

/**
 * Why the sidebar does not yet satisfy `wanted`, or null when it does. Names
 * match case-insensitively by substring (row text may carry extras).
 */
export function missingDevices(
  wanted: number | readonly string[],
  visible: readonly string[],
): string | null {
  if (typeof wanted === "number") {
    return visible.length >= wanted
      ? null
      : `expected ${wanted} device${wanted === 1 ? "" : "s"} in the sidebar, found ${visible.length}`;
  }
  const shown = visible.map((name) => name.trim().toLowerCase());
  const missing = wanted.filter(
    (name) => !shown.some((entry) => entry.includes(name.trim().toLowerCase())),
  );
  return missing.length
    ? `device ${missing.map((n) => `"${n}"`).join(", ")} not in the sidebar`
    : null;
}

export function trackRef(track: Track): StageTrackRef {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
  };
}

/** Case-insensitive match on title, then artist/album when the ref has them. */
export function findTrack(
  library: readonly Track[],
  ref: StageTrackRef,
): Track | undefined {
  const same = (a: string | null, b: string | null) =>
    (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
  const matches = library.filter(
    (t) =>
      same(t.title, ref.title) &&
      (ref.artist === null || same(t.artist, ref.artist)) &&
      (ref.album === null || same(t.album, ref.album)),
  );
  return matches[0];
}
