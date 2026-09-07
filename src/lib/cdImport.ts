import {
  albumKey,
  albumImportMetadata,
  findMatchingLibraryAlbum,
  groupTracksIntoAlbums,
} from "./albums";
import { resolveCdSharedArtPath } from "./cdArt";
import { isCdImportCancelRequested } from "./cdImportGuard";
import { errorMessageFromUnknown } from "./cdPlaybackFailure";
import { t } from "./i18n";
import {
  commitImportEntries,
  importCompletionSettleOptions,
  resolveImportDuplicates,
  type ImportResult,
  type ParsedImportEntry,
} from "./import";
import {
  flushImportActivationQueue,
  queueImportedTrackActivation,
  queuePendingImportRemoval,
  resetImportActivationQueue,
} from "./importActivationQueue";
import {
  allocPendingTrackId,
  pendingTrackFromInput,
  resetPendingTrackIds,
} from "./pendingImportTrack";
import { createOperationId, logActivity } from "./activityLog";
import { yieldForInteraction } from "./scheduling";
import { cleanupCdImportTemp, ripCdTrack } from "./tauri";
import { cdImportFailedSettleOptions } from "./toastPayloads";
import {
  blockIfTrialLibraryAtCap,
  isTrialLibraryCapError,
  notifyTrialLibraryCap,
} from "./trialGate";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useCdImportStore } from "../store/useCdImportStore";
import {
  isImportCancelledError,
  useImportDedupeStore,
} from "../store/useImportDedupeStore";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useLibrarySettingsStore } from "../store/useLibrarySettingsStore";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";
import type { Album } from "../types/album";
import type { CdDisc } from "../types/cd";
import type { TrackMetadataUpdate } from "../types/metadata";
import { mbidFieldsFrom, type Track, type TrackInput } from "../types/track";

export class CdImportCancelledError extends Error {
  constructor() {
    super(t("toasts:import.cancelled"));
    this.name = "CdImportCancelledError";
  }
}

export function isCdImportCancelledError(err: unknown): boolean {
  return err instanceof CdImportCancelledError;
}

interface CdImportTrackPlan {
  trackNumber: number;
  metadata: TrackMetadataUpdate;
  durationSeconds: number | null;
  pendingId: number;
  rating: number;
}

async function exitCancelledImport(
  driveId: string,
  importedTracks: Track[],
): Promise<never> {
  flushImportActivationQueue();
  await cleanupCdImportTemp(driveId);

  if (importedTracks.length > 0) {
    useCdImportStore.getState().setCancelPrompt({
      driveId,
      tracks: [...importedTracks],
    });
  }

  throw new CdImportCancelledError();
}

export function startCdImport(options: {
  driveId: string;
  /** Disc with CD-Text and remote metadata already merged for display. */
  disc: CdDisc;
  year?: number | null;
  checkedTrackNumbers: number[];
}): void {
  const { driveId, disc, year = null, checkedTrackNumbers } = options;
  if (checkedTrackNumbers.length === 0) return;

  if (blockIfTrialLibraryAtCap()) return;

  usePlayerStore.getState().stopCdPlaybackForDrive(driveId);
  resetImportActivationQueue();
  resetPendingTrackIds();
  useImportDedupeStore.getState().resetImportDedupeSession();

  const operationId = createOperationId();

  useBackgroundTasksStore.getState().runInBackground({
    key: "cd-import",
    label: t("toasts:import.cd"),
    cancellable: true,
    progressDisplay: "bar",
    run: async (ctx) => {
      const cdImport = useCdImportStore.getState();
      let cancelled = false;
      let outcomeLogged = false;
      const result: ImportResult = {
        imported: 0,
        skipped: 0,
        replaced: 0,
        failed: 0,
        errors: [],
        lyricsFromTags: 0,
        lyricsFromSidecar: 0,
        lyricsNone: 0,
      };
      try {
        logActivity({
          level: "info",
          domain: ACTIVITY_LOG_DOMAINS.import,
          message: "Starting CD import",
          operationId,
          details: {
            driveId,
            trackCount: checkedTrackNumbers.length,
          },
        });

        const library = usePlayerStore.getState().library;
        const existingAlbum = findMatchingLibraryAlbum(
          groupTracksIntoAlbums(library),
          disc,
        );
        const plans = buildImportPlans(
          disc,
          year,
          checkedTrackNumbers,
          existingAlbum,
        );

        if (plans.length === 0) {
          logActivity({
            level: "warn",
            domain: ACTIVITY_LOG_DOMAINS.import,
            message: "CD import had no tracks selected",
            operationId,
            details: { driveId },
          });
          outcomeLogged = true;
          ctx.settleAs({
            status: "warning",
            label: t("toasts:import.noTracksSelected"),
          });
          return;
        }

        ctx.setLabel(t("toasts:import.checkingDuplicates"));
        let duplicateResolutions;
        try {
          duplicateResolutions = await resolveImportDuplicates(
            plans.map((plan) => ({
              sourcePath: "",
              metadata: planMetadataToTrackInput(plan),
              pendingId: plan.pendingId,
            })),
            { incomingPendingRip: true },
          );
        } catch (err) {
          if (isImportCancelledError(err)) {
            throw new CdImportCancelledError();
          }
          throw err;
        }

        const plansToImport = plans.filter(
          (plan) => !duplicateResolutions.skippedPendingIds.has(plan.pendingId),
        );

        if (plansToImport.length === 0) {
          result.skipped = duplicateResolutions.skippedPendingIds.size;
          logCdImportCompleted(result, operationId, driveId);
          outcomeLogged = true;
          ctx.settleAs(importCompletionSettleOptions(result, operationId));
          return;
        }

        cdImport.startImport(
          driveId,
          plansToImport.map((plan) => plan.trackNumber),
        );

        const settings =
          useLibrarySettingsStore.getState().settings ??
          (await useLibrarySettingsStore.getState().loadSettings());
        const profileId = settings.cdImportProfileId;

        const albumArtist =
          plansToImport[0].metadata.albumArtist ??
          plansToImport[0].metadata.artist;
        const albumTitle = plansToImport[0].metadata.album;
        const releaseMbid = disc.releaseMbid?.trim() || null;
        const sharedArtPath = await resolveCdSharedArtPath({
          driveId,
          existingAlbumArtPath: existingAlbum?.artPath,
          albumArtist,
          albumTitle,
          releaseMbid,
          onFetching: () => ctx.setDetail(t("toasts:import.fetchingArt")),
        });
        ctx.clearDetail();

        result.skipped = duplicateResolutions.skippedPendingIds.size;
        const entries: ParsedImportEntry[] = [];
        const importedTracks: Track[] = [];
        const total = plansToImport.length;

        ctx.setLabel(t("toasts:import.cd"));
        for (let i = 0; i < plansToImport.length; i++) {
          if (isCdImportCancelRequested()) {
            await exitCancelledImport(driveId, importedTracks);
          }

          const plan = plansToImport[i];
          cdImport.setRipIndex(i);
          ctx.setProgress(i, total);
          if (total > 1) {
            ctx.setDetail(
              t("toasts:progress.trackOf", {
                current: i + 1,
                total,
              }),
            );
          }

          try {
            const metadata: TrackMetadataUpdate = {
              ...plan.metadata,
              artPath: sharedArtPath,
              artChanged: sharedArtPath != null,
            };

            const filePath = await ripCdTrack(
              driveId,
              plan.trackNumber,
              profileId,
              metadata,
            );

            if (isCdImportCancelRequested()) {
              await exitCancelledImport(driveId, importedTracks);
            }

            const trackInput: TrackInput = {
              ...planMetadataToTrackInput(plan),
              filePath,
              artPath: sharedArtPath,
            };

            const entry = {
              sourcePath: filePath,
              metadata: trackInput,
              pendingId: plan.pendingId,
            };
            entries.push(entry);

            usePlayerStore
              .getState()
              .stagePendingImportTracks([
                pendingTrackFromInput(plan.pendingId, filePath, trackInput),
              ]);

            const trackResult = await commitImportEntries([entry], {
              mode: "copy",
              duplicateActions: duplicateResolutions.duplicateActions,
              onTrackActivated: (activatedId, track) => {
                importedTracks.push(track);
                queueImportedTrackActivation(activatedId, track);
              },
              onTrackFailed: (failedId) => {
                queuePendingImportRemoval(failedId);
              },
              onTrackReplaced: (replacedId, track) => {
                queuePendingImportRemoval(replacedId);
                usePlayerStore.getState().updateTrackInLibrary(track);
              },
            });
            result.imported += trackResult.imported;
            result.replaced += trackResult.replaced;
            result.failed += trackResult.failed;
            result.errors.push(...trackResult.errors);
            result.lyricsFromTags += trackResult.lyricsFromTags;
            result.lyricsFromSidecar += trackResult.lyricsFromSidecar;
            result.lyricsNone += trackResult.lyricsNone;

            if (trackResult.imported > 0 || trackResult.replaced > 0) {
              cdImport.completeTrack(plan.trackNumber);
            }
          } catch (err) {
            if (isCdImportCancelledError(err) || isImportCancelledError(err)) {
              throw err;
            }
            recordCdTrackFailure(result, operationId, plan, err);
            queuePendingImportRemoval(plan.pendingId);
          }

          if (isCdImportCancelRequested()) {
            await exitCancelledImport(driveId, importedTracks);
          }

          await yieldForInteraction();
        }

        if (isCdImportCancelRequested()) {
          await exitCancelledImport(driveId, importedTracks);
        }

        ctx.clearProgress();
        ctx.clearDetail();

        flushImportActivationQueue();
        await cleanupCdImportTemp(driveId);

        if (result.imported > 0 || result.replaced > 0) {
          await usePlayerStore.getState().loadLibrary();
          const firstEntry = entries[0]?.metadata;
          if (firstEntry) {
            const key = albumKey({
              id: 0,
              title: firstEntry.title,
              artist: firstEntry.artist,
              album: firstEntry.album,
              albumArtist: firstEntry.albumArtist,
              trackNumber: firstEntry.trackNumber,
              totalTracks: firstEntry.totalTracks,
              discNumber: firstEntry.discNumber,
              totalDiscs: firstEntry.totalDiscs,
              year: firstEntry.year,
              genre: firstEntry.genre,
              durationSeconds: firstEntry.durationSeconds,
              sampleRate: null,
              bitrate: null,
              codec: null,
              filePath: firstEntry.filePath,
              artPath: firstEntry.artPath,
              dateAdded: "",
              playCount: 0,
              lastPlayedAt: null,
              rating: firstEntry.rating ?? 0,
            });
            useNavigationStore.getState().openAlbum(key);
          }
        }

        const settle = importCompletionSettleOptions(result, operationId);
        logCdImportCompleted(result, operationId, driveId);
        outcomeLogged = true;

        if (result.failed > 0) {
          const trialCapHit = result.errors.some(isTrialLibraryCapError);
          if (trialCapHit) {
            notifyTrialLibraryCap();
            if (result.imported === 0 && result.replaced === 0) {
              ctx.dismissSilently();
              return;
            }
          }
        }

        ctx.settleAs(settle);
      } catch (err) {
        if (isCdImportCancelledError(err)) {
          cancelled = true;
          throw err;
        }
        if (isImportCancelledError(err)) {
          cancelled = true;
          throw new CdImportCancelledError();
        }
        await cleanupCdImportTemp(driveId).catch(() => undefined);
        if (!outcomeLogged) {
          logActivity({
            level: "error",
            domain: ACTIVITY_LOG_DOMAINS.import,
            message: "CD import failed",
            operationId,
            details: { driveId, error: errorMessageFromUnknown(err) },
          });
        }
        if (
          result.imported > 0 ||
          result.replaced > 0 ||
          result.skipped > 0 ||
          result.failed > 0
        ) {
          ctx.settleAs(importCompletionSettleOptions(result, operationId));
        } else {
          ctx.settleAs(
            cdImportFailedSettleOptions({ logLink: { operationId } }),
          );
        }
      } finally {
        cdImport.finishImport({ preserveCompletedDisplay: !cancelled });
        cdImport.clearCancelRequest();
        resetPendingTrackIds();
      }
    },
  });
}

function logCdImportCompleted(
  result: ImportResult,
  operationId: string,
  driveId: string,
): void {
  logActivity({
    level: result.failed > 0 ? "warn" : "info",
    domain: ACTIVITY_LOG_DOMAINS.import,
    message: "CD import completed",
    operationId,
    details: {
      driveId,
      imported: result.imported,
      replaced: result.replaced,
      skipped: result.skipped,
      failed: result.failed,
      lyricsFromTags: result.lyricsFromTags,
      lyricsFromSidecar: result.lyricsFromSidecar,
      lyricsNone: result.lyricsNone,
      ...(result.errors.length > 0 ? { errors: result.errors } : {}),
    },
  });
}

function recordCdTrackFailure(
  result: ImportResult,
  operationId: string,
  plan: CdImportTrackPlan,
  err: unknown,
): void {
  result.failed += 1;
  const message = errorMessageFromUnknown(err);
  const title = plan.metadata.title ?? `Track ${plan.trackNumber}`;
  result.errors.push(t("toasts:import.cdTrackFailed", { title }));
  logActivity({
    level: "warn",
    domain: ACTIVITY_LOG_DOMAINS.import,
    message: "CD track import failed",
    operationId,
    details: {
      trackNumber: plan.trackNumber,
      title,
      error: message,
    },
  });
}

function planMetadataToTrackInput(plan: CdImportTrackPlan): TrackInput {
  return {
    title: plan.metadata.title,
    artist: plan.metadata.artist,
    album: plan.metadata.album,
    albumArtist: plan.metadata.albumArtist,
    trackNumber: plan.metadata.trackNumber,
    totalTracks: plan.metadata.totalTracks,
    discNumber: plan.metadata.discNumber,
    totalDiscs: plan.metadata.totalDiscs,
    year: plan.metadata.year,
    genre: plan.metadata.genre,
    durationSeconds: plan.durationSeconds,
    sampleRate: null,
    bitrate: null,
    codec: null,
    filePath: "",
    artPath: plan.metadata.artPath,
    rating: plan.rating,
    ...mbidFieldsFrom(plan.metadata),
  };
}

export function buildImportPlans(
  disc: CdDisc,
  year: number | null,
  checkedTrackNumbers: number[],
  existingAlbum?: Album,
): CdImportTrackPlan[] {
  const checked = new Set(checkedTrackNumbers);
  const canonical = existingAlbum ? albumImportMetadata(existingAlbum) : null;
  const album =
    canonical?.album ?? (disc.album?.trim() || t("common:unknownAlbum"));
  const albumArtist = canonical?.albumArtist ?? (disc.artist?.trim() || null);
  const importYear = canonical?.year ?? year ?? disc.year ?? null;
  const genre = canonical?.genre ?? disc.genre ?? null;
  const defaultTrackArtist = canonical?.defaultTrackArtist ?? albumArtist;

  return disc.tracks
    .filter((track) => checked.has(track.number))
    .sort((a, b) => a.number - b.number)
    .map((track) => ({
      trackNumber: track.number,
      pendingId: allocPendingTrackId(),
      metadata: {
        title: track.title?.trim() || `Track ${track.number}`,
        artist: track.artist?.trim() || defaultTrackArtist,
        album,
        albumArtist,
        trackNumber: track.number,
        totalTracks: disc.tracks.length,
        discNumber: 1,
        totalDiscs: 1,
        year: importYear,
        genre,
        artPath: null,
        artChanged: false,
        ...mbidFieldsFrom({
          recordingMbid: track.recordingMbid?.trim() || null,
          releaseMbid: disc.releaseMbid?.trim() || null,
          artistMbids: track.artistMbids,
          albumArtistMbids: disc.albumArtistMbids,
        }),
      },
      durationSeconds: track.durationSeconds ?? null,
      rating: track.rating ?? 0,
    }));
}
