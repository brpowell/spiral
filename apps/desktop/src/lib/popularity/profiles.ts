import type { PopularityParams } from "./popularity";

/**
 * Named presets for the scoring params. A profile is just a time horizon; pick the one that
 * matches the question being asked, and add a new one here when a surface needs a different
 * horizon.
 */
export const POPULARITY_PROFILES = {
  /** What's being listened to lately: a listen loses half its weight in about six weeks. */
  trending: { halfLifeDays: 45 },
  /** Long-run favourites: a listen loses half its weight in about a year. */
  favorites: { halfLifeDays: 365 },
  /** Plain lifetime totals, no decay. */
  allTime: { halfLifeDays: null },
} as const satisfies Record<string, PopularityParams>;

export type PopularityProfile = keyof typeof POPULARITY_PROFILES;

/** The profile behind the track list's Popularity column and its sort. */
export const POPULARITY_COLUMN_PROFILE: PopularityProfile = "favorites";
