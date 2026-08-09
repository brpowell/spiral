import { useCallback, useEffect, useState } from "react";
import {
  createLyricsFetchFeedback,
  type LyricsLibraryTrackRef,
} from "../../lib/lyricsFetch";
import { commitFetchedLyricsForTrack } from "../../lib/lyricsFetchCommit";
import { missingFileErrorDetail } from "../../lib/missingFileTrack";
import { useLyricsFetchStore } from "../../store/useLyricsFetchStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import type { LyricsSearchCandidate } from "../../types/lyrics";
import { LyricsCandidatePicker } from "../LyricsCandidatePicker/LyricsCandidatePicker";

/**
 * Sequential post-fetch disambiguation: toast Review/Choose opens this queue
 * over all ambiguous tracks collected during a bulk (or solo) lyrics fetch.
 */
export function LyricsReviewQueue() {
  const reviewQueueTrackIds = useLyricsFetchStore((s) => s.reviewQueueTrackIds);
  const reviewQueueIndex = useLyricsFetchStore((s) => s.reviewQueueIndex);
  const pendingByTrackId = useLyricsFetchStore((s) => s.pendingByTrackId);
  const advanceReviewQueue = useLyricsFetchStore((s) => s.advanceReviewQueue);
  const closeReviewQueue = useLyricsFetchStore((s) => s.closeReviewQueue);
  const library = usePlayerStore((s) => s.library);

  const [committing, setCommitting] = useState(false);

  const trackId = reviewQueueTrackIds[reviewQueueIndex] ?? null;
  const track =
    trackId != null
      ? (library.find((entry) => entry.id === trackId) ?? null)
      : null;
  const candidates =
    trackId != null ? (pendingByTrackId[trackId]?.candidates ?? []) : [];
  const open = trackId != null && candidates.length > 0 && !committing;

  // Skip slots whose candidates were cleared while the queue is open.
  useEffect(() => {
    if (reviewQueueTrackIds.length === 0 || committing) return;
    if (trackId == null) return;
    if (candidates.length === 0) {
      advanceReviewQueue();
    }
  }, [
    advanceReviewQueue,
    candidates.length,
    committing,
    reviewQueueTrackIds.length,
    trackId,
  ]);

  const libraryTrack: LyricsLibraryTrackRef | null = track
    ? {
        title: track.title,
        artist: track.artist ?? "",
        album: track.album ?? "",
        durationSeconds: track.durationSeconds,
      }
    : null;

  const handleSelect = useCallback(
    async (candidate: LyricsSearchCandidate) => {
      if (trackId == null) return;
      if (track == null) {
        // Track left the library — drop this slot and continue.
        advanceReviewQueue();
        return;
      }
      setCommitting(true);
      try {
        const result = await commitFetchedLyricsForTrack(track, {
          plainText: candidate.lyrics.plainText,
          lines: candidate.lyrics.lines,
          format: candidate.lyrics.format,
        });
        if (result.status === "missing_file") {
          useLyricsFetchStore.getState().applyOutcome(trackId, {
            feedback: createLyricsFetchFeedback(missingFileErrorDetail(track)),
            candidates: [],
          });
        } else if (result.status === "error") {
          useLyricsFetchStore.getState().applyOutcome(trackId, {
            feedback: createLyricsFetchFeedback(
              "Fetched lyrics couldn't be saved. Try again or use Save.",
            ),
            candidates: [],
          });
        }
        // Advance clears pending for this track (or re-clears empty) and moves on.
        advanceReviewQueue();
      } finally {
        setCommitting(false);
      }
    },
    [advanceReviewQueue, track, trackId],
  );

  const handleSkip = useCallback(() => {
    advanceReviewQueue();
  }, [advanceReviewQueue]);

  const handleClose = useCallback(() => {
    closeReviewQueue();
  }, [closeReviewQueue]);

  return (
    <LyricsCandidatePicker
      open={open}
      candidates={candidates}
      libraryTrack={libraryTrack}
      queuePosition={
        reviewQueueTrackIds.length > 1
          ? {
              current: reviewQueueIndex + 1,
              total: reviewQueueTrackIds.length,
            }
          : undefined
      }
      onSelect={(candidate) => {
        void handleSelect(candidate);
      }}
      onSkip={handleSkip}
      onClose={handleClose}
    />
  );
}
