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
  applyOutcome: (trackId: number, ui: TrackLyricsFetchUI) => void;
  takePending: (trackId: number) => TrackLyricsFetchUI | null;
  clearPending: (trackId: number) => void;
  setFetching: (trackId: number, isFetching: boolean) => void;
  setQueued: (trackId: number, isQueued: boolean) => void;
}

export const useLyricsFetchStore = create<LyricsFetchState>((set, get) => ({
  pendingByTrackId: {},
  fetchingTrackIds: new Set(),
  queuedTrackIds: new Set(),

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
      const { [trackId]: _removed, ...pendingByTrackId } = state.pendingByTrackId;
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
}));
