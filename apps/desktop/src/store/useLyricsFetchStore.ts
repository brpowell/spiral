import { create } from "zustand";
import type { LyricsSearchCandidate } from "../types/lyrics";
import type { LyricsFetchFeedback } from "../lib/lyricsFetch";

export type TrackLyricsFetchUI = {
  feedback: LyricsFetchFeedback | null;
  candidates: LyricsSearchCandidate[];
};

interface LyricsFetchState {
  pendingByTrackId: Record<number, TrackLyricsFetchUI>;
  fetchingTrackIds: Set<number>;
  queuedTrackIds: Set<number>;
  /** Ordered track IDs for the post-fetch candidate review pass. */
  reviewQueueTrackIds: number[];
  reviewQueueIndex: number;
  applyOutcome: (trackId: number, ui: TrackLyricsFetchUI) => void;
  takePending: (trackId: number) => TrackLyricsFetchUI | null;
  clearPending: (trackId: number) => void;
  setFetching: (trackId: number, isFetching: boolean) => void;
  setQueued: (trackId: number, isQueued: boolean) => void;
  /**
   * Start a review pass over tracks that still have pending candidates.
   * Empty after filtering → no-op (queue stays closed).
   */
  openReviewQueue: (trackIds: number[]) => void;
  /**
   * Drop the current track's pending candidates and advance.
   * Clears the queue when past the last item.
   */
  advanceReviewQueue: () => void;
  /**
   * Close the review UI without clearing remaining pending candidates
   * so a later Review click can resume them.
   */
  closeReviewQueue: () => void;
}

function clearReviewQueueState(): Pick<
  LyricsFetchState,
  "reviewQueueTrackIds" | "reviewQueueIndex"
> {
  return { reviewQueueTrackIds: [], reviewQueueIndex: 0 };
}

export const useLyricsFetchStore = create<LyricsFetchState>((set, get) => ({
  pendingByTrackId: {},
  fetchingTrackIds: new Set(),
  queuedTrackIds: new Set(),
  reviewQueueTrackIds: [],
  reviewQueueIndex: 0,

  applyOutcome: (trackId, ui) =>
    set((state) => ({
      pendingByTrackId: {
        ...state.pendingByTrackId,
        [trackId]: ui,
      },
    })),

  takePending: (trackId) => {
    const pending = get().pendingByTrackId[trackId];
    if (!pending) return null;
    get().clearPending(trackId);
    return pending;
  },

  clearPending: (trackId) =>
    set((state) => {
      if (!(trackId in state.pendingByTrackId)) return state;
      const { [trackId]: _removed, ...pendingByTrackId } =
        state.pendingByTrackId;
      return { pendingByTrackId };
    }),

  setFetching: (trackId, isFetching) =>
    set((state) => {
      const has = state.fetchingTrackIds.has(trackId);
      if (isFetching === has) return state;
      const fetchingTrackIds = new Set(state.fetchingTrackIds);
      if (isFetching) {
        fetchingTrackIds.add(trackId);
      } else {
        fetchingTrackIds.delete(trackId);
      }
      return { fetchingTrackIds };
    }),

  setQueued: (trackId, isQueued) =>
    set((state) => {
      const has = state.queuedTrackIds.has(trackId);
      if (isQueued === has) return state;
      const queuedTrackIds = new Set(state.queuedTrackIds);
      if (isQueued) {
        queuedTrackIds.add(trackId);
      } else {
        queuedTrackIds.delete(trackId);
      }
      return { queuedTrackIds };
    }),

  openReviewQueue: (trackIds) => {
    const pending = get().pendingByTrackId;
    const filtered = trackIds.filter(
      (id) => (pending[id]?.candidates.length ?? 0) > 0,
    );
    if (filtered.length === 0) {
      set(clearReviewQueueState());
      return;
    }
    set({ reviewQueueTrackIds: filtered, reviewQueueIndex: 0 });
  },

  advanceReviewQueue: () => {
    const { reviewQueueTrackIds, reviewQueueIndex } = get();
    if (reviewQueueTrackIds.length === 0) return;

    const currentId = reviewQueueTrackIds[reviewQueueIndex];
    if (currentId != null) {
      get().clearPending(currentId);
    }

    const nextIndex = reviewQueueIndex + 1;
    if (nextIndex >= reviewQueueTrackIds.length) {
      set(clearReviewQueueState());
      return;
    }
    set({ reviewQueueIndex: nextIndex });
  },

  closeReviewQueue: () => set(clearReviewQueueState()),
}));
