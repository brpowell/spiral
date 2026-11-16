import { create } from "zustand";
import { getTrackPopularity } from "@/lib/tauri";
import { toTrackScores, type TrackScores } from "@/lib/popularity/popularity";
import {
  POPULARITY_PROFILES,
  type PopularityProfile,
} from "@/lib/popularity/profiles";

interface PopularityState {
  /** Latest scores per profile. A profile is absent until its first load finishes. */
  scores: Partial<Record<PopularityProfile, TrackScores>>;
  /** Highest score in each loaded profile, the reference for drawing a score as a fraction. */
  topScore: Partial<Record<PopularityProfile, number>>;
  /** Bumped whenever listen history changes; consumers reload when it moves. */
  version: number;
  /** Version each profile's `scores` were computed at. */
  loadedVersion: Partial<Record<PopularityProfile, number>>;
  load: (profile: PopularityProfile) => Promise<void>;
  /** Listen history changed (a listen was recorded or cleared): scores are stale. */
  invalidate: () => void;
}

/** Version a profile is currently being fetched at, to avoid duplicate in-flight requests. */
const inFlight = new Map<PopularityProfile, number>();

export const usePopularityStore = create<PopularityState>((set, get) => ({
  scores: {},
  topScore: {},
  version: 0,
  loadedVersion: {},

  load: async (profile) => {
    const { version, loadedVersion } = get();
    if (
      loadedVersion[profile] === version ||
      inFlight.get(profile) === version
    ) {
      return;
    }
    inFlight.set(profile, version);
    try {
      const rows = await getTrackPopularity(POPULARITY_PROFILES[profile]);
      // History changed while this was in flight; the newer version's load will replace it.
      if (get().version !== version) return;
      set((state) => ({
        scores: { ...state.scores, [profile]: toTrackScores(rows) },
        topScore: {
          ...state.topScore,
          [profile]: rows.reduce((top, row) => Math.max(top, row.score), 0),
        },
        loadedVersion: { ...state.loadedVersion, [profile]: version },
      }));
    } catch (err) {
      console.error("getTrackPopularity failed:", err);
    } finally {
      if (inFlight.get(profile) === version) inFlight.delete(profile);
    }
  },

  invalidate: () => set((state) => ({ version: state.version + 1 })),
}));
