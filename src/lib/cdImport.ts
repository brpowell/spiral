import { albumKey, albumImportMetadata, findMatchingLibraryAlbum, groupTracksIntoAlbums } from "./albums";
import { resolveCdSharedArtPath } from "./cdArt";
import { isCdImportCancelRequested } from "./cdImportGuard";
import {
  commitImportEntries,
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
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
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

        cdImport.startImport(
          driveId,
          plans.map((plan) => plan.trackNumber),
        );

        const albumArtist = plans[0].metadata.albumArtist ?? plans[0].metadata.artist;
        const albumTitle = plans[0].metadata.album;
        const sharedArtPath = await resolveCdSharedArtPath({
          driveId,
          existingAlbumArtPath: existingAlbum?.artPath,
          albumArtist,
          albumTitle,
          onFetching: () => ctx.setDetail("Fetching album art…"),
        });
        ctx.clearDetail();

        const entries: ParsedImportEntry[] = [];
        const result: ImportResult = { imported: 0, failed: 0, errors: [] };
        const importedTracks: Track[] = [];

        for (let i = 0; i < plans.length; i++) {
          if (isCdImportCancelRequested()) {
            await exitCancelledImport(driveId, importedTracks);
          }

          const plan = plans[i];
          cdImport.setRipIndex(i);
          ctx.setLabel("Importing CD");
          if (plans.length > 1) {
            ctx.setDetail(`Track ${i + 1} of ${plans.length}`);
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
            metadata,
          );

          if (isCdImportCancelRequested()) {
            await exitCancelledImport(driveId, importedTracks);
          }

          const trackInput: TrackInput = {
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            albumArtist: metadata.albumArtist,
            trackNumber: metadata.trackNumber,
            discNumber: metadata.discNumber,
            year: metadata.year,
            genre: metadata.genre,
            durationSeconds: plan.durationSeconds,
            filePath,
            artPath: sharedArtPath,
          };

          const pendingId = allocPendingTrackId();
          const entry = { sourcePath: filePath, metadata: trackInput, pendingId };
          entries.push(entry);

          usePlayerStore.getState().stagePendingImportTracks([
            pendingTrackFromInput(pendingId, filePath, trackInput),
          ]);

          const trackResult = await commitImportEntries([entry], {
            mode: "copy",
            onTrackActivated: (activatedId, track) => {
              importedTracks.push(track);
              queueImportedTrackActivation(activatedId, track);
            },
            onTrackFailed: (failedId) => {
              queuePendingImportRemoval(failedId);
            },
          });
          result.imported += trackResult.imported;
          result.failed += trackResult.failed;
          result.errors.push(...trackResult.errors);

          if (trackResult.imported > 0) {
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

        if (result.imported > 0) {
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
              discNumber: firstEntry.discNumber,
              year: firstEntry.year,
              genre: firstEntry.genre,
              durationSeconds: firstEntry.durationSeconds,
              filePath: firstEntry.filePath,
              artPath: firstEntry.artPath,
              dateAdded: "",
              playCount: 0,
            });
            useNavigationStore.getState().openAlbum(key);
          }
        }

        if (result.imported > 0) {
          ctx.setLabel(
            result.imported === 1
              ? "Imported 1 track"
              : `Imported ${result.imported} tracks`,
          );
        } else {
          ctx.setLabel("Import finished");
        }

        if (result.failed > 0) {
          usePlayerStore.setState({
            importError: `Imported ${result.imported}, failed ${result.failed}. ${result.errors[0] ?? ""}`,
          });
          if (result.imported === 0) {
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
      metadata: {
        title: track.title?.trim() || `Track ${track.number}`,
        artist: track.artist?.trim() || defaultTrackArtist,
        album,
        albumArtist,
        trackNumber: track.number,
        discNumber: 1,
        year: importYear,
        genre,
        artPath: null,
        artChanged: false,
      },
      durationSeconds: track.durationSeconds ?? null,
    }));
}
