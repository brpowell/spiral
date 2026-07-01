import { convertTrack } from "./tauri";
import { createOperationId, logActivity } from "./activityLog";
import { formatFailureDetail } from "./formatFailureDetail";
import { getEncodingProfile } from "./encodingProfiles";
import {
  discoverTrackFileMissing,
  isTrackMissingFile,
} from "./missingFileTrack";
import { isTrackConvertible } from "./pendingImportTrack";
import { showPlaybackFileMissingToast } from "./playbackToast";
import { yieldForInteraction } from "./scheduling";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useConvertStore } from "../store/useConvertStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";
import type { Track } from "../types/track";

export type ConvertMode = "replace" | "add_new";

export function filterConvertibleTrackIds(
  trackIds: number[],
  library: Track[],
): number[] {
  return [...new Set(trackIds)].filter((id) => {
    const track = library.find((item) => item.id === id);
    return (
      track != null &&
      isTrackConvertible(track) &&
      !isTrackMissingFile(track)
    );
  });
}

async function resolveConvertibleCandidatesOnDisk(
  candidateIds: number[],
  library: Track[],
): Promise<number[]> {
  const updateTrackInLibrary = usePlayerStore.getState().updateTrackInLibrary;
  const resolved: number[] = [];

  for (const id of candidateIds) {
    const track = library.find((item) => item.id === id);
    if (!track) continue;

    const missing = await discoverTrackFileMissing(track, updateTrackInLibrary);
    if (!missing) {
      resolved.push(id);
    }
  }

  return resolved;
}

function notifyConvertFailure(summary: string, detail: string): void {
  useBackgroundTasksStore.getState().showErrorToast({
    key: "convert-tracks-error",
    label: summary,
    detail,
  });
  usePlayerStore.setState({
    importError: detail ? `${summary}. ${detail}` : summary,
  });
}

export function openConvertForTrackIds(trackIds: number[]): void {
  void (async () => {
    const library = usePlayerStore.getState().library;
    const candidates = filterConvertibleTrackIds(trackIds, library);
    const convertibleIds = await resolveConvertibleCandidatesOnDisk(
      candidates,
      library,
    );

    if (convertibleIds.length === 0) {
      if (candidates.length > 0) {
        const track = library.find((item) => item.id === candidates[0]);
        if (track) {
          showPlaybackFileMissingToast(track);
        }
      }
      return;
    }

    const result = await useConvertStore.getState().promptConvert(convertibleIds);
    if (result) {
      startConvertTracks({
        trackIds: convertibleIds,
        profileId: result.profileId,
        mode: result.mode,
      });
    }
  })();
}

export function startConvertTracks(options: {
  trackIds: number[];
  profileId: string;
  mode: ConvertMode;
}): void {
  const { trackIds, profileId, mode } = options;
  if (trackIds.length === 0) return;

  const operationId = createOperationId();
  const profileLabel = getEncodingProfile(profileId)?.label ?? profileId;

  useBackgroundTasksStore.getState().runInBackground({
    key: "convert-tracks",
    label: trackIds.length === 1 ? "Converting track…" : "Converting tracks…",
    run: async (ctx) => {
      logActivity({
        level: "info",
        domain: ACTIVITY_LOG_DOMAINS.convert,
        message: "Starting track convert",
        operationId,
        details: {
          profileId,
          mode,
          trackCount: trackIds.length,
          trackIds,
        },
      });

      let converted = 0;
      let failed = 0;
      const errors: string[] = [];
      const librarySnapshot = usePlayerStore.getState().library;

      for (let i = 0; i < trackIds.length; i++) {
        const trackId = trackIds[i];
        if (trackIds.length > 1) {
          ctx.setDetail(`Track ${i + 1} of ${trackIds.length}`);
        } else {
          ctx.clearDetail();
        }
        ctx.setProgress(i, trackIds.length);

        try {
          await convertTrack({ trackId, profileId, mode });
          converted += 1;
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : String(err);
          const title =
            librarySnapshot.find((track) => track.id === trackId)?.title ??
            `Track ${trackId}`;
          const line = `${title}: ${message}`;
          errors.push(line);
          logActivity({
            level: "warn",
            domain: ACTIVITY_LOG_DOMAINS.convert,
            message: "Track convert failed",
            operationId,
            details: {
              trackId,
              title,
              profileId,
              mode,
              error: message,
            },
          });
          if (trackIds.length > 1) {
            ctx.setDetail(formatFailureDetail(errors, 2));
          }
        }

        await yieldForInteraction();
      }

      ctx.setProgress(trackIds.length, trackIds.length);

      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });

      const summary =
        failed === 0
          ? converted === 1
            ? "Converted 1 track"
            : `Converted ${converted} tracks`
          : converted === 0
            ? `Convert failed (${failed})`
            : `Converted ${converted}, failed ${failed}`;

      ctx.setLabel(summary);

      logActivity({
        level: failed > 0 ? "warn" : "info",
        domain: ACTIVITY_LOG_DOMAINS.convert,
        message: "Track convert completed",
        operationId,
        details: {
          profileId,
          profileLabel,
          mode,
          converted,
          failed,
          ...(errors.length > 0 ? { errors } : {}),
        },
      });

      if (failed > 0) {
        const detail = formatFailureDetail(errors);
        ctx.setDetail(detail);
        notifyConvertFailure(summary, detail || errors[0] || "Convert failed");
        throw new Error(summary);
      }

      ctx.clearDetail();
    },
  });
}
