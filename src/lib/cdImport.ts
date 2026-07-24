import { albumKey, albumImportMetadata, findMatchingLibraryAlbum, groupTracksIntoAlbums } from "./albums";
import { resolveCdSharedArtPath } from "./cdArt";
import { isCdImportCancelRequested } from "./cdImportGuard";
import {
  commitImportEntries,
  formatImportLyricsDetail,
  formatImportSummary,
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
import { yieldForInteraction } from "./scheduling";
import {
  cleanupCdImportTemp,
  ripCdTrack,
} from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useCdImportStore } from "../store/useCdImportStore";
import {
  isImportCancelledError,
  useImportDedupeStore,
} from "../store/useImportDedupeStore";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useLibrarySettingsStore } from "../store/useLibrarySettingsStore";
import type { Album } from "../types/album";
import type { CdDisc } from "../types/cd";
import type { TrackMetadataUpdate } from "../types/metadata";
import type { Track, TrackInput } from "../types/track";

export class CdImportCancelledError extends Error {
  constructor() {
    super("Import cancelled");
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

  usePlayerStore.getState().stopCdPlaybackForDrive(driveId);
  usePlayerStore.setState({ importError: null });
  resetImportActivationQueue();
  resetPendingTrackIds();
  useImportDedupeStore.getState().resetImportDedupeSession();

  useBackgroundTasksStore.getState().runInBackground({
    key: "cd-import",
    label: "Importing CD",
    cancellable: true,
    run: async (ctx) => {
      const cdImport = useCdImportStore.getState();
      let cancelled = false;
      try {
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
          throw new Error("No tracks selected to import");
        }

        ctx.setLabel("Checking for duplicates…");
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
            ctx.setLabel("Import cancelled");
            return;
          }
          throw err;
        }

        const plansToImport = plans.filter(
          (plan) => !duplicateResolutions.skippedPendingIds.has(plan.pendingId),
        );

        if (plansToImport.length === 0) {
          ctx.setLabel(
            formatImportSummary({
              imported: 0,
              replaced: 0,
              skipped: duplicateResolutions.skippedPendingIds.size,
            }),
          );
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

        const albumArtist = plansToImport[0].metadata.albumArtist ?? plansToImport[0].metadata.artist;
        const albumTitle = plansToImport[0].metadata.album;
        const sharedArtPath = await resolveCdSharedArtPath({
          driveId,
          existingAlbumArtPath: existingAlbum?.artPath,
          albumArtist,
          albumTitle,
          onFetching: () => ctx.setDetail("Fetching album art…"),
        });
        ctx.clearDetail();

        const entries: ParsedImportEntry[] = [];
        const result: ImportResult = {
          imported: 0,
          skipped: duplicateResolutions.skippedPendingIds.size,
          replaced: 0,
          failed: 0,
          errors: [],
          lyricsFromTags: 0,
          lyricsFromSidecar: 0,
          lyricsNone: 0,
        };
        const importedTracks: Track[] = [];

        for (let i = 0; i < plansToImport.length; i++) {
          if (isCdImportCancelRequested()) {
            await exitCancelledImport(driveId, importedTracks);
          }

          const plan = plansToImport[i];
          cdImport.setRipIndex(i);
          ctx.setLabel("Importing CD");
          if (plansToImport.length > 1) {
            ctx.setDetail(`Track ${i + 1} of ${plansToImport.length}`);
          } else {
            ctx.clearDetail();
          }

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

          usePlayerStore.getState().stagePendingImportTracks([
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
              filePath: firstEntry.filePath,
              artPath: firstEntry.artPath,
              dateAdded: "",
              playCount: 0,
              lastPlayedAt: null,
              rating: 0,
            });
            useNavigationStore.getState().openAlbum(key);
          }
        }

        const summary = formatImportSummary(result);
        ctx.setLabel(summary);
        const lyricsDetail = formatImportLyricsDetail(result);
        if (lyricsDetail) {
          ctx.setDetail(lyricsDetail);
        } else {
          ctx.clearDetail();
        }

        if (result.failed > 0) {
          usePlayerStore.setState({
            importError: `${summary}; failed ${result.failed}. ${result.errors[0] ?? ""}`,
          });
          if (result.imported === 0 && result.replaced === 0) {
            throw new Error(result.errors[0] ?? "Import failed");
          }
        }
      } catch (err) {
        if (isCdImportCancelledError(err)) {
          cancelled = true;
        } else {
          await cleanupCdImportTemp(driveId);
        }
        throw err;
      } finally {
        cdImport.finishImport({ preserveCompletedDisplay: !cancelled });
        cdImport.clearCancelRequest();
        resetPendingTrackIds();
      }
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
  };
}

function buildImportPlans(
  disc: CdDisc,
  year: number | null,
  checkedTrackNumbers: number[],
  existingAlbum?: Album,
): CdImportTrackPlan[] {
  const checked = new Set(checkedTrackNumbers);
  const canonical = existingAlbum ? albumImportMetadata(existingAlbum) : null;
  const album = canonical?.album ?? (disc.album?.trim() || "Unknown Album");
  const albumArtist = canonical?.albumArtist ?? (disc.artist?.trim() || null);
  const importYear = canonical?.year ?? year;
  const genre = canonical?.genre ?? null;
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
      },
      durationSeconds: track.durationSeconds ?? null,
    }));
}
