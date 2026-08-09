import { beforeEach, describe, expect, it } from "vitest";
import type { LyricsSearchCandidate } from "../types/lyrics";
import { useLyricsFetchStore } from "./useLyricsFetchStore";

function candidate(id: number): LyricsSearchCandidate {
  return {
    id,
    trackName: `Track ${id}`,
    artistName: "Artist",
    albumName: "Album",
    duration: 180,
    lyrics: {
      format: "plain",
      source: "lrclib",
      lines: [],
      plainText: "la la",
    },
  };
}

function seedPending(trackId: number, candidateIds: number[]): void {
  useLyricsFetchStore.getState().applyOutcome(trackId, {
    feedback: null,
    candidates: candidateIds.map(candidate),
  });
}

describe("useLyricsFetchStore review queue", () => {
  beforeEach(() => {
    useLyricsFetchStore.setState({
      pendingByTrackId: {},
      fetchingTrackIds: new Set(),
      queuedTrackIds: new Set(),
      reviewQueueTrackIds: [],
      reviewQueueIndex: 0,
    });
  });

  it("openReviewQueue keeps only tracks that still have candidates", () => {
    seedPending(1, [10]);
    seedPending(2, []);
    seedPending(3, [30]);

    useLyricsFetchStore.getState().openReviewQueue([1, 2, 3, 99]);

    expect(useLyricsFetchStore.getState().reviewQueueTrackIds).toEqual([1, 3]);
    expect(useLyricsFetchStore.getState().reviewQueueIndex).toBe(0);
  });

  it("openReviewQueue no-ops when nothing has candidates", () => {
    seedPending(1, []);
    useLyricsFetchStore.getState().openReviewQueue([1]);
    expect(useLyricsFetchStore.getState().reviewQueueTrackIds).toEqual([]);
  });

  it("advanceReviewQueue clears current pending and moves to the next", () => {
    seedPending(1, [10]);
    seedPending(2, [20]);
    useLyricsFetchStore.getState().openReviewQueue([1, 2]);

    useLyricsFetchStore.getState().advanceReviewQueue();

    expect(useLyricsFetchStore.getState().pendingByTrackId[1]).toBeUndefined();
    expect(
      useLyricsFetchStore.getState().pendingByTrackId[2]?.candidates,
    ).toHaveLength(1);
    expect(useLyricsFetchStore.getState().reviewQueueIndex).toBe(1);
    expect(useLyricsFetchStore.getState().reviewQueueTrackIds).toEqual([1, 2]);
  });

  it("advanceReviewQueue clears the queue after the last item", () => {
    seedPending(1, [10]);
    useLyricsFetchStore.getState().openReviewQueue([1]);

    useLyricsFetchStore.getState().advanceReviewQueue();

    expect(useLyricsFetchStore.getState().reviewQueueTrackIds).toEqual([]);
    expect(useLyricsFetchStore.getState().reviewQueueIndex).toBe(0);
    expect(useLyricsFetchStore.getState().pendingByTrackId[1]).toBeUndefined();
  });

  it("closeReviewQueue leaves remaining pending intact", () => {
    seedPending(1, [10]);
    seedPending(2, [20]);
    useLyricsFetchStore.getState().openReviewQueue([1, 2]);

    useLyricsFetchStore.getState().closeReviewQueue();

    expect(useLyricsFetchStore.getState().reviewQueueTrackIds).toEqual([]);
    expect(
      useLyricsFetchStore.getState().pendingByTrackId[1]?.candidates,
    ).toHaveLength(1);
    expect(
      useLyricsFetchStore.getState().pendingByTrackId[2]?.candidates,
    ).toHaveLength(1);
  });
});
