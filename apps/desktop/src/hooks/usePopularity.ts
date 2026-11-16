import { useEffect } from "react";
import {
  popularityFraction,
  type TrackScores,
} from "@/lib/popularity/popularity";
import type { PopularityProfile } from "@/lib/popularity/profiles";
import { usePopularityStore } from "@/store/usePopularityStore";

const NO_SCORES: TrackScores = new Map();

/**
 * Per-track popularity scores for a named profile (see `POPULARITY_PROFILES`).
 *
 * Scores are cached across consumers and reload when listen history changes. While a reload is
 * running the previous scores stay available, so UI built on them doesn't flicker. Feed `scores`
 * to `aggregateScores` / `rankByScore` to roll them up into albums, artists, genres and so on.
 * `ready` is false until the first load finishes. Pass `enabled: false` to skip loading while
 * nothing on screen needs the scores.
 */
export function usePopularity(
  profile: PopularityProfile,
  { enabled = true }: { enabled?: boolean } = {},
): {
  scores: TrackScores;
  ready: boolean;
} {
  const scores = usePopularityStore((state) => state.scores[profile]);
  const version = usePopularityStore((state) => state.version);
  const load = usePopularityStore((state) => state.load);

  useEffect(() => {
    if (enabled) void load(profile);
  }, [enabled, load, profile, version]);

  return { scores: scores ?? NO_SCORES, ready: scores !== undefined };
}

/** One track's raw popularity score (0 when it has no listening signal). */
export function usePopularityScore(
  profile: PopularityProfile,
  trackId: number,
): number {
  return usePopularityStore(
    (state) => state.scores[profile]?.get(trackId) ?? 0,
  );
}

/**
 * One track's popularity as a 0..1 fraction of the profile's top score, for drawing. It selects a
 * single number, so a row re-renders only when its own value changes. Pair with `usePopularity`
 * (or the track list, which loads it) so the scores are actually loaded.
 */
export function usePopularityFraction(
  profile: PopularityProfile,
  trackId: number,
): number {
  return usePopularityStore((state) =>
    popularityFraction(
      state.scores[profile]?.get(trackId) ?? 0,
      state.topScore[profile] ?? 0,
    ),
  );
}
