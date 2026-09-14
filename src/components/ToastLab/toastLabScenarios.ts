import { BackgroundTaskCancelledError } from "../../lib/backgroundTaskCancel";
import { createOperationId, logActivityEntry } from "../../lib/activityLog";
import { convertTracksSettleOptions } from "../../lib/convertTracks";
import { t } from "../../lib/i18n";
import { lyricsFetchBulkSettleOptions } from "../../lib/lyricsFetchToastSettle";
import {
  activityLogCopiedPayload,
  availableUpdatePayload,
  availableUpdateActions,
  bulkTrackMetadataSavePayload,
  cdPlaybackFailurePayload,
  cdHeroArtFetchedSettleOptions,
  cdImportFailedSettleOptions,
  cdMetadataFailedSettleOptions,
  cdMetadataFoundSettleOptions,
  cdMetadataNotFoundSettleOptions,
  diagnosticsCopiedPayload,
  diagnosticsSavedPayload,
  lyricsAmbiguousPayload,
  lyricsNoneMissingPayload,
  packInstalledPayload,
  packInstallFailedPayload,
  packDownloadFailedPayload,
  packReloadedPayload,
  packUpdatesSettleOptions,
  playbackFileMissingPayload,
  libraryPlaybackFailedPayload,
  libraryLoadFailedPayload,
  importPickerFailedPayload,
  playlistAddedPayload,
  queueAddedPayload,
  spiralCardFinalizedPayload,
  spiralCardFinalizeNetworkErrorPayload,
  spiralCardInstallSuccessPayload,
  themeCreateFailedPayload,
  themeDeletedPayload,
  themeSavedPayload,
  updaterCheckErrorPayload,
} from "../../lib/toastPayloads";
import { PACK_UPDATES_BULK_KEY } from "../../lib/packRegistry";
import {
  importCompletionSettleOptions,
  importNoAudioSettleOptions,
} from "../../lib/import";
import { libraryRefreshSettleOptions } from "../../lib/refreshLibraryMetadata";
import { ACTIVITY_LOG_DOMAINS } from "../../types/activityLog";
import type { LyricsSearchCandidate } from "../../types/lyrics";
import type { Track } from "../../types/track";
import type {
  BackgroundTaskRunContext,
  useBackgroundTasksStore,
} from "../../store/useBackgroundTasksStore";
import { useLyricsFetchStore } from "../../store/useLyricsFetchStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUpdaterStore } from "../../store/useUpdaterStore";
import { useWhatsNewStore } from "../../store/useWhatsNewStore";

type Store = ReturnType<typeof useBackgroundTasksStore.getState>;

export type ToastLabFireContext = {
  showToast: Store["showToast"];
  showErrorToast: Store["showErrorToast"];
  runInBackground: Store["runInBackground"];
  dismissMs: number | null | undefined;
  sleep: (ms: number) => Promise<void>;
};

export type ToastLabScenario = {
  id: string;
  group: string;
  buttonLabel: string;
  /** Production source module for audit traceability. */
  source: string;
  fire: (ctx: ToastLabFireContext) => void | Promise<void>;
};

/** Lab-only stub tracks so the review picker can show “Your track”. */
function toastLabStubTrack(
  overrides: Partial<Track> & Pick<Track, "id" | "title">,
): Track {
  return {
    artist: "Lab Artist",
    album: "Lab Album",
    albumArtist: "Lab Artist",
    trackNumber: 1,
    totalTracks: null,
    discNumber: 1,
    totalDiscs: null,
    year: 2024,
    genre: "Lab",
    durationSeconds: 200,
    sampleRate: 44_100,
    bitrate: 320,
    codec: "mp3",
    filePath: `/toast-lab/${overrides.id}.mp3`,
    artPath: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    playCount: 0,
    lastPlayedAt: null,
    rating: 0,
    lyricsFormat: null,
    ...overrides,
  };
}

function toastLabCandidate(
  id: number,
  overrides: Partial<LyricsSearchCandidate> = {},
): LyricsSearchCandidate {
  return {
    id,
    trackName: overrides.trackName ?? `Lab Match ${id}`,
    artistName: overrides.artistName ?? "Lab Artist",
    albumName: overrides.albumName ?? `Album ${id}`,
    duration: overrides.duration ?? 200,
    lyrics: overrides.lyrics ?? {
      format: "plain",
      source: "lrclib",
      lines: [],
      plainText: `toast-lab lyrics ${id}`,
    },
    ...overrides,
  };
}

/**
 * Seed pending candidates (+ stub library rows) for review-queue demos.
 * Toast Lab is a separate webview, so this does not touch the main app library.
 */
function seedToastLabLyricsReview(
  items: Array<{
    trackId: number;
    title: string;
    artist?: string;
    album?: string;
    durationSeconds?: number;
    candidates: LyricsSearchCandidate[];
  }>,
): number[] {
  const store = useLyricsFetchStore.getState();
  const stubs = items.map((item) =>
    toastLabStubTrack({
      id: item.trackId,
      title: item.title,
      artist: item.artist ?? "Lab Artist",
      album: item.album ?? "Lab Album",
      durationSeconds: item.durationSeconds ?? 200,
    }),
  );
  usePlayerStore.setState((state) => {
    const keep = state.library.filter(
      (track) => !stubs.some((stub) => stub.id === track.id),
    );
    return { library: [...keep, ...stubs] };
  });
  for (const item of items) {
    store.applyOutcome(item.trackId, {
      feedback: null,
      candidates: item.candidates,
    });
  }
  return items.map((item) => item.trackId);
}

async function simulateTrackProgress(
  ctx: BackgroundTaskRunContext,
  sleep: (ms: number) => Promise<void>,
  total: number,
  stepMs = 400,
): Promise<void> {
  for (let i = 1; i <= total; i++) {
    ctx.setDetail(t("toasts:progress.trackOf", { current: i, total }));
    ctx.setProgress(i, total);
    await sleep(stepMs);
  }
}

type ImportLabResult = Parameters<typeof importCompletionSettleOptions>[0];

async function seedToastLabLog(
  domain: (typeof ACTIVITY_LOG_DOMAINS)[keyof typeof ACTIVITY_LOG_DOMAINS],
  operationId: string,
  message: string,
  details: Record<string, unknown>,
  level?: "info" | "warn" | "error",
): Promise<void> {
  const resolvedLevel =
    level ??
    (typeof details.failed === "number" && details.failed > 0
      ? "warn"
      : "info");
  try {
    await logActivityEntry({
      level: resolvedLevel,
      domain,
      message,
      operationId,
      details,
    });
  } catch (err: unknown) {
    console.error("Toast Lab: failed to append sample log entry", err);
  }
}

function fireConvertOutcome(
  {
    runInBackground,
    dismissMs,
    sleep,
  }: Pick<ToastLabFireContext, "runInBackground" | "dismissMs" | "sleep">,
  options: {
    total: number;
    converted: number;
    failed: number;
    errors: string[];
    operationId: string;
    stepMs?: number;
  },
): void {
  const { total, converted, failed, errors, operationId, stepMs } = options;
  void runInBackground({
    key: "convert-tracks",
    label: t("toasts:convert.running", { count: total }),
    progressDisplay: "bar",
    run: async (ctx) => {
      await simulateTrackProgress(ctx, sleep, total, stepMs);
      ctx.settleAs({
        ...convertTracksSettleOptions({
          converted,
          failed,
          errors,
          operationId,
        }),
        dismissMs,
      });
    },
  });
}

function fireImportOutcome(
  {
    runInBackground,
    dismissMs,
    sleep,
  }: Pick<ToastLabFireContext, "runInBackground" | "dismissMs" | "sleep">,
  options: {
    result: ImportLabResult;
    operationId: string;
    sleepMs?: number;
  },
): void {
  const { result, operationId, sleepMs = 400 } = options;
  const total =
    result.imported + result.replaced + result.skipped + result.failed;
  void runInBackground({
    key: "library-import",
    label: t("toasts:import.library"),
    progressDisplay: "bar",
    run: async (ctx) => {
      if (total > 1) {
        ctx.setLabel(t("toasts:import.importing", { count: total }));
        await simulateTrackProgress(ctx, sleep, total, Math.min(120, sleepMs));
      } else {
        await sleep(sleepMs);
      }
      ctx.settleAs({
        ...importCompletionSettleOptions(result, operationId),
        dismissMs,
      });
    },
  });
}

function fireCdImportOutcome(
  {
    runInBackground,
    dismissMs,
    sleep,
  }: Pick<ToastLabFireContext, "runInBackground" | "dismissMs" | "sleep">,
  options: {
    result: ImportLabResult;
    operationId: string;
    skipRip?: boolean;
  },
): void {
  const { result, operationId, skipRip = false } = options;
  const total =
    result.imported + result.replaced + result.skipped + result.failed;
  void runInBackground({
    key: "cd-import",
    label: t("toasts:import.cd"),
    cancellable: true,
    progressDisplay: "bar",
    run: async (ctx) => {
      ctx.setLabel(t("toasts:import.checkingDuplicates"));
      await sleep(500);
      if (skipRip) {
        ctx.settleAs({
          ...importCompletionSettleOptions(result, operationId),
          dismissMs,
        });
        return;
      }
      ctx.setDetail(t("toasts:import.fetchingArt"));
      await sleep(400);
      ctx.clearDetail();
      ctx.setLabel(t("toasts:import.cd"));
      for (let i = 0; i < total; i++) {
        if (ctx.isCancelRequested()) {
          throw new BackgroundTaskCancelledError(t("toasts:import.cancelled"), {
            dismissMs,
          });
        }
        ctx.setProgress(i, total);
        if (total > 1) {
          ctx.setDetail(
            t("toasts:progress.trackOf", { current: i + 1, total }),
          );
        }
        await sleep(280);
      }
      ctx.setProgress(total, total);
      ctx.settleAs({
        ...importCompletionSettleOptions(result, operationId),
        dismissMs,
      });
    },
  });
}

/**
 * Scope toast keys to the scenario id so variants that share a production key
 * (e.g. queue-one vs queue-many both use `queue-added`) can stack for comparison.
 * Re-firing the same scenario still replaces itself.
 */
export function toastLabScenarioFireCtx(
  ctx: ToastLabFireContext,
  scenarioId: string,
): ToastLabFireContext {
  const scopeKey = (key: string | undefined) =>
    key ? `${key}::lab::${scenarioId}` : `lab::${scenarioId}`;

  return {
    ...ctx,
    showToast: (options) =>
      ctx.showToast({ ...options, key: scopeKey(options.key) }),
    showErrorToast: (options) =>
      ctx.showErrorToast({ ...options, key: scopeKey(options.key) }),
    runInBackground: (options) =>
      ctx.runInBackground({ ...options, key: scopeKey(options.key) }),
  };
}

/** Matches lab update-available toasts so What's New can focus the pending row. */
export const TOAST_LAB_UPDATE_VERSION = "0.9.9";

function seedToastLabPendingUpdate() {
  useUpdaterStore.setState({
    status: "available",
    availableUpdate: {
      version: TOAST_LAB_UPDATE_VERSION,
      currentVersion: "0.9.8",
      date: "2026-08-26T12:00:00.000Z",
      body: [
        "### Features",
        "",
        "* Toast Lab preview of pending update notes",
        "",
        "### Bug Fixes",
        "",
        "* Example fix shown when this version is not in history yet",
      ].join("\n"),
    },
  });
}

export function toastLabUpdateAvailableActions() {
  return availableUpdateActions({
    onUpdate: () => {
      /* Lab preview — no install. */
    },
    onWhatsNew: () => {
      seedToastLabPendingUpdate();
      useWhatsNewStore.getState().openWhatsNew(TOAST_LAB_UPDATE_VERSION);
    },
  });
}

const EXAMPLE_TRACK = { title: "Example Track Title" };

export const TOAST_LAB_SCENARIOS: ToastLabScenario[] = [
  // —— Queue & playlists ——
  {
    id: "queue-one",
    group: "Queue & playlists",
    buttonLabel: "Queue · 1 track",
    source: "queueToast.ts",
    fire: ({ showToast, dismissMs }) => {
      const payload = queueAddedPayload([EXAMPLE_TRACK], { dismissMs });
      if (payload) showToast(payload);
    },
  },
  {
    id: "queue-many",
    group: "Queue & playlists",
    buttonLabel: "Queue · N tracks",
    source: "queueToast.ts",
    fire: ({ showToast, dismissMs }) => {
      const payload = queueAddedPayload(
        Array.from({ length: 5 }, (_, i) => ({ title: `Track ${i + 1}` })),
        { dismissMs },
      );
      if (payload) showToast(payload);
    },
  },
  {
    id: "playlist-one",
    group: "Queue & playlists",
    buttonLabel: "Playlist · 1 track",
    source: "playlistToast.ts",
    fire: ({ showToast, dismissMs }) => {
      const payload = playlistAddedPayload([EXAMPLE_TRACK], "Favorites", {
        dismissMs,
      });
      if (payload) showToast(payload);
    },
  },
  {
    id: "playlist-many",
    group: "Queue & playlists",
    buttonLabel: "Playlist · N tracks",
    source: "playlistToast.ts",
    fire: ({ showToast, dismissMs }) => {
      const payload = playlistAddedPayload(
        Array.from({ length: 4 }, (_, i) => ({ title: `Track ${i + 1}` })),
        "Road Trip",
        { dismissMs },
      );
      if (payload) showToast(payload);
    },
  },

  // —— Playback ——
  {
    id: "playback-file-missing",
    group: "Playback",
    buttonLabel: "File not found",
    source: "playbackToast.ts",
    fire: ({ showErrorToast, dismissMs }) => {
      showErrorToast(playbackFileMissingPayload(EXAMPLE_TRACK, { dismissMs }));
    },
  },
  {
    id: "cd-disconnected",
    group: "Playback",
    buttonLabel: "CD · disconnected",
    source: "cdPlaybackFailure.ts",
    fire: ({ showErrorToast, dismissMs }) => {
      showErrorToast(
        cdPlaybackFailurePayload("disconnected", "Disc drive disconnected", {
          dismissMs,
        }),
      );
    },
  },
  {
    id: "cd-no-disc",
    group: "Playback",
    buttonLabel: "CD · no disc",
    source: "cdPlaybackFailure.ts",
    fire: ({ showErrorToast, dismissMs }) => {
      showErrorToast(
        cdPlaybackFailurePayload("no_disc", "No audio CD in drive", {
          dismissMs,
        }),
      );
    },
  },
  {
    id: "cd-generic",
    group: "Playback",
    buttonLabel: "CD · generic error",
    source: "cdPlaybackFailure.ts",
    fire: async ({ showErrorToast, dismissMs }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.cdPlayback,
        operationId,
        "Toast Lab: sample CD playback failure",
        {
          kind: "generic",
          rawMessage: "SCSI sense: medium error",
        },
        "error",
      );
      showErrorToast(
        cdPlaybackFailurePayload("generic", "SCSI sense: medium error", {
          dismissMs,
          logLink: { operationId },
        }),
      );
    },
  },
  {
    id: "library-playback-failed",
    group: "Playback",
    buttonLabel: "Library · playback failed",
    source: "unexpectedErrorToast.ts",
    fire: async ({ showErrorToast, dismissMs }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.libraryPlayback,
        operationId,
        "Toast Lab: sample library playback failure",
        {
          rawMessage: "Decoder error: unsupported codec",
        },
        "error",
      );
      showErrorToast(
        libraryPlaybackFailedPayload({
          dismissMs,
          logLink: { operationId },
        }),
      );
    },
  },
  {
    id: "library-load-failed",
    group: "Library",
    buttonLabel: "Library load failed",
    source: "unexpectedErrorToast.ts",
    fire: async ({ showErrorToast, dismissMs }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.libraryLoad,
        operationId,
        "Toast Lab: sample library load failure",
        {
          rawMessage: "database is locked",
        },
        "error",
      );
      showErrorToast(
        libraryLoadFailedPayload({
          dismissMs,
          logLink: { operationId },
        }),
      );
    },
  },
  {
    id: "import-picker-failed",
    group: "Import",
    buttonLabel: "Import picker failed",
    source: "unexpectedErrorToast.ts",
    fire: async ({ showErrorToast, dismissMs }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample import picker failure",
        {
          rawMessage: "dialog cancelled unexpectedly",
        },
        "error",
      );
      showErrorToast(
        importPickerFailedPayload({
          dismissMs,
          logLink: { operationId },
        }),
      );
    },
  },

  // —— Track metadata ——
  {
    id: "metadata-partial-missing",
    group: "Track metadata",
    buttonLabel: "Save · updated + missing",
    source: "trackMetadataToast.ts",
    fire: ({ showToast, dismissMs }) => {
      const payload = bulkTrackMetadataSavePayload({
        updated: 2,
        errors: ["Gone: File not found"],
        dismissMs,
      });
      if (payload) showToast(payload);
    },
  },
  {
    id: "metadata-partial-fail",
    group: "Track metadata",
    buttonLabel: "Save · partial (1 fail)",
    source: "trackMetadataToast.ts",
    fire: ({ showToast, dismissMs }) => {
      const payload = bulkTrackMetadataSavePayload({
        updated: 2,
        errors: ["Track: Permission denied"],
        dismissMs,
      });
      if (payload) showToast(payload);
    },
  },
  {
    id: "metadata-missing",
    group: "Track metadata",
    buttonLabel: "Save · all missing",
    source: "trackMetadataToast.ts",
    fire: async ({ showToast, dismissMs }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.metadataSave,
        operationId,
        "Toast Lab: sample metadata save all-missing",
        {
          total: 2,
          updated: 0,
          missing: 2,
          failed: 0,
          errors: ["A: File not found", "B: File not found"],
        },
        "warn",
      );
      const payload = bulkTrackMetadataSavePayload({
        updated: 0,
        errors: ["A: File not found", "B: File not found"],
        operationId,
        dismissMs,
      });
      if (payload) showToast(payload);
    },
  },
  {
    id: "metadata-failed",
    group: "Track metadata",
    buttonLabel: "Save · 1 failed",
    source: "trackMetadataToast.ts",
    fire: ({ showToast, dismissMs }) => {
      const payload = bulkTrackMetadataSavePayload({
        updated: 0,
        errors: ["Track: Permission denied"],
        dismissMs,
      });
      if (payload) showToast(payload);
    },
  },
  {
    id: "metadata-failed-multi",
    group: "Track metadata",
    buttonLabel: "Save · 2+ failed",
    source: "trackMetadataToast.ts",
    fire: async ({ showToast, dismissMs }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.metadataSave,
        operationId,
        "Toast Lab: sample metadata save multi-fail",
        {
          errors: ["A: Permission denied", "B: Disk full"],
        },
        "warn",
      );
      const payload = bulkTrackMetadataSavePayload({
        updated: 0,
        errors: ["A: Permission denied", "B: Disk full"],
        operationId,
        dismissMs,
      });
      if (payload) showToast(payload);
    },
  },
  {
    id: "library-refresh-ok",
    group: "Track metadata",
    buttonLabel: "Refresh · success",
    source: "refreshLibraryMetadata.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "library-metadata-refresh",
        label: t("toasts:libraryRefresh.running"),
        run: async (ctx) => {
          await sleep(800);
          ctx.settleAs({
            ...libraryRefreshSettleOptions(
              { updated: 12, missing: 0, failed: 0, errors: [] },
              "toast-lab-refresh-ok",
            ),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "library-refresh-missing",
    group: "Track metadata",
    buttonLabel: "Refresh · updated + missing",
    source: "refreshLibraryMetadata.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.refresh,
        operationId,
        "Toast Lab: sample library refresh updated + missing",
        {
          updated: 10,
          missing: 2,
          failed: 0,
          errors: ["A: File not found", "B: File not found"],
        },
        "warn",
      );
      void runInBackground({
        key: "library-metadata-refresh",
        label: t("toasts:libraryRefresh.running"),
        run: async (ctx) => {
          await sleep(800);
          ctx.settleAs({
            ...libraryRefreshSettleOptions(
              {
                updated: 10,
                missing: 2,
                failed: 0,
                errors: ["A: File not found", "B: File not found"],
              },
              operationId,
            ),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "library-refresh-partial",
    group: "Track metadata",
    buttonLabel: "Refresh · partial (1 fail)",
    source: "refreshLibraryMetadata.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.refresh,
        operationId,
        "Toast Lab: sample library refresh partial",
        {
          updated: 10,
          missing: 2,
          failed: 1,
          errors: [
            "A: File not found",
            "B: File not found",
            "Track X: Permission denied",
          ],
        },
      );
      void runInBackground({
        key: "library-metadata-refresh",
        label: t("toasts:libraryRefresh.running"),
        run: async (ctx) => {
          await sleep(800);
          ctx.settleAs({
            ...libraryRefreshSettleOptions(
              {
                updated: 10,
                missing: 2,
                failed: 1,
                errors: [
                  "A: File not found",
                  "B: File not found",
                  "Track X: Permission denied",
                ],
              },
              operationId,
            ),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "library-refresh-failed",
    group: "Track metadata",
    buttonLabel: "Refresh · all failed",
    source: "refreshLibraryMetadata.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.refresh,
        operationId,
        "Toast Lab: sample library refresh all-failed",
        {
          failed: 3,
          errors: ["A: Permission denied", "B: Disk full", "C: I/O error"],
        },
      );
      void runInBackground({
        key: "library-metadata-refresh",
        label: t("toasts:libraryRefresh.running"),
        run: async (ctx) => {
          await sleep(800);
          ctx.settleAs({
            ...libraryRefreshSettleOptions(
              {
                updated: 0,
                missing: 0,
                failed: 3,
                errors: [
                  "A: Permission denied",
                  "B: Disk full",
                  "C: I/O error",
                ],
              },
              operationId,
            ),
            dismissMs,
          });
        },
      });
    },
  },

  // —— Lyrics ——
  {
    id: "lyrics-none-missing",
    group: "Lyrics",
    buttonLabel: "None missing",
    source: "fetchMissingLyrics.ts",
    fire: ({ showToast, dismissMs }) => {
      showToast(lyricsNoneMissingPayload({ dismissMs }));
    },
  },
  {
    id: "lyrics-solo-fetch",
    group: "Lyrics",
    buttonLabel: "Solo fetch → success",
    source: "lyricsFetchQueue.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "lyrics-fetch-bulk",
        label: t("toasts:lyrics.fetchingFor", { title: "Song" }),
        run: async (ctx) => {
          await sleep(900);
          ctx.setDetail(t("toasts:lyrics.retryDetail"));
          await sleep(700);
          ctx.settleAs({
            status: "success",
            label: t("toasts:lyrics.fetchedFor", { title: "Song" }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "lyrics-solo-ambiguous",
    group: "Lyrics",
    buttonLabel: "Solo · ambiguous",
    source: "lyricsFetchQueue.ts",
    fire: ({ showToast, dismissMs }) => {
      const [trackId] = seedToastLabLyricsReview([
        {
          trackId: 7,
          title: "Song",
          candidates: [
            toastLabCandidate(101, {
              trackName: "Song",
              artistName: "Artist A",
              albumName: "Album A",
              duration: 200,
            }),
            toastLabCandidate(102, {
              trackName: "Song",
              artistName: "Artist B",
              albumName: "Album B",
              duration: 198,
              lyrics: {
                format: "line_synced",
                source: "lrclib",
                lines: [],
                plainText: "version b",
              },
            }),
          ],
        },
      ]);
      showToast(lyricsAmbiguousPayload("Song", { dismissMs, trackId }));
    },
  },
  {
    id: "lyrics-review-queue",
    group: "Lyrics",
    buttonLabel: "Review queue · 3 tracks",
    source: "lyricsFetchToastSettle.ts",
    fire: ({ showToast, dismissMs }) => {
      const trackIds = seedToastLabLyricsReview([
        {
          trackId: 901,
          title: "Neon Highways",
          artist: "Circuit Bloom",
          album: "Night Drive",
          durationSeconds: 214,
          candidates: [
            toastLabCandidate(9011, {
              trackName: "Neon Highways",
              artistName: "Circuit Bloom",
              albumName: "Night Drive",
              duration: 214,
            }),
            toastLabCandidate(9012, {
              trackName: "Neon Highways",
              artistName: "Circuit Bloom",
              albumName: "Night Drive (Deluxe)",
              duration: 218,
            }),
          ],
        },
        {
          trackId: 902,
          title: "Static Bloom",
          artist: "Violet Static",
          album: "Afterimage",
          durationSeconds: 189,
          candidates: [
            toastLabCandidate(9021, {
              trackName: "Static Bloom",
              artistName: "Violet Static",
              albumName: "Afterimage",
              duration: 189,
              lyrics: {
                format: "line_synced",
                source: "lrclib",
                lines: [],
                plainText: "synced take",
              },
            }),
            toastLabCandidate(9022, {
              trackName: "Static Bloom",
              artistName: "Violet Static Feat.",
              albumName: "Afterimage",
              duration: 191,
            }),
            toastLabCandidate(9023, {
              trackName: "Static Bloom (Live)",
              artistName: "Violet Static",
              albumName: "Afterimage Live",
              duration: 203,
            }),
          ],
        },
        {
          trackId: 903,
          title: "Glass Harbor",
          artist: "Marina Echo",
          album: "Tide Charts",
          durationSeconds: 241,
          candidates: [
            toastLabCandidate(9031, {
              trackName: "Glass Harbor",
              artistName: "Marina Echo",
              albumName: "Tide Charts",
              duration: 241,
            }),
            toastLabCandidate(9032, {
              trackName: "Glass Harbour",
              artistName: "Marina Echo",
              albumName: "Tide Charts",
              duration: 240,
            }),
          ],
        },
      ]);
      const settle = lyricsFetchBulkSettleOptions({
        tally: { found: 0, notFound: 0, ambiguous: 3, failed: 0 },
        reviewTrackIds: trackIds,
      });
      showToast({
        key: "lyrics-fetch-bulk",
        label: settle.label,
        status: settle.status,
        actions: settle.actions,
        dismissMs,
      });
    },
  },
  {
    id: "lyrics-bulk",
    group: "Lyrics",
    buttonLabel: "Bulk fetch → mixed",
    source: "lyricsFetchQueue.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      const errorLines = ["Song D: network timeout"];
      seedToastLabLyricsReview([
        {
          trackId: 3,
          title: "Song C",
          candidates: [
            toastLabCandidate(201, {
              trackName: "Song C",
              albumName: "Album One",
              duration: 210,
              lyrics: {
                format: "plain",
                source: "lrclib",
                lines: [],
                plainText: "match one",
              },
            }),
            toastLabCandidate(202, {
              trackName: "Song C",
              albumName: "Album Two",
              duration: 205,
              lyrics: {
                format: "plain",
                source: "lrclib",
                lines: [],
                plainText: "match two",
              },
            }),
          ],
        },
      ]);
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.lyricsFetch,
        operationId,
        "Toast Lab: sample lyrics fetch mixed",
        {
          found: 1,
          notFound: 1,
          ambiguous: 1,
          failed: 1,
          errors: errorLines,
          ambiguousTrackIds: [3],
        },
      );
      void runInBackground({
        key: "lyrics-fetch-bulk",
        label: t("toasts:lyrics.fetching"),
        progressDisplay: "bar",
        run: async (ctx) => {
          const titles = ["Song A", "Song B", "Song C", "Song D"];
          for (let i = 0; i < titles.length; i++) {
            ctx.setDetail(titles[i]);
            ctx.setProgress(i, titles.length);
            await sleep(350);
          }
          ctx.setProgress(titles.length, titles.length);
          ctx.settleAs({
            ...lyricsFetchBulkSettleOptions({
              tally: {
                found: 1,
                notFound: 1,
                ambiguous: 1,
                failed: 1,
              },
              errorLines,
              operationId,
              reviewTrackIds: [3],
            }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "lyrics-bulk-failed",
    group: "Lyrics",
    buttonLabel: "Bulk fetch → all failed",
    source: "lyricsFetchQueue.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      const errors = [
        "Song A: network timeout",
        "Song B: connection refused",
        "Song C: timed out",
      ];
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.lyricsFetch,
        operationId,
        "Toast Lab: sample lyrics fetch all-failed",
        { failed: 3, found: 0, errors },
      );
      void runInBackground({
        key: "lyrics-fetch-bulk",
        label: t("toasts:lyrics.fetching"),
        progressDisplay: "bar",
        run: async (ctx) => {
          const titles = ["Song A", "Song B", "Song C"];
          for (let i = 0; i < titles.length; i++) {
            ctx.setDetail(titles[i]);
            ctx.setProgress(i, titles.length);
            await sleep(350);
          }
          ctx.setProgress(titles.length, titles.length);
          ctx.settleAs({
            ...lyricsFetchBulkSettleOptions({
              tally: {
                found: 0,
                notFound: 0,
                ambiguous: 0,
                failed: 3,
              },
              errorLines: errors,
              operationId,
            }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "lyrics-bulk-success",
    group: "Lyrics",
    buttonLabel: "Bulk fetch → all fetched",
    source: "lyricsFetchQueue.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "lyrics-fetch-bulk",
        label: t("toasts:lyrics.fetching"),
        progressDisplay: "bar",
        run: async (ctx) => {
          for (let i = 1; i <= 8; i++) {
            ctx.setDetail(`Song ${i}`);
            ctx.setProgress(i, 8);
            await sleep(120);
          }
          ctx.settleAs({
            ...lyricsFetchBulkSettleOptions({
              tally: {
                found: 8,
                notFound: 0,
                ambiguous: 0,
                failed: 0,
              },
            }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "lyrics-missing-job",
    group: "Lyrics",
    buttonLabel: "Fetch missing → cancel",
    source: "fetchMissingLyrics.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "lyrics-fetch-missing",
        label: t("toasts:lyricsMissing.fetching"),
        cancellable: true,
        progressDisplay: "bar",
        run: async (ctx) => {
          ctx.setDetail(t("toasts:lyricsMissing.checkingCache"));
          await sleep(600);
          for (let i = 1; i <= 8; i++) {
            if (ctx.isCancelRequested()) {
              throw new BackgroundTaskCancelledError(
                t("toasts:lyricsMissing.cancelledAttempted", { count: i - 1 }),
                { dismissMs },
              );
            }
            ctx.setDetail(`Track ${i}`);
            ctx.setProgress(i, 8);
            await sleep(280);
          }
          ctx.settleAs({
            ...lyricsFetchBulkSettleOptions({
              tally: {
                found: 8,
                notFound: 0,
                ambiguous: 0,
                failed: 0,
              },
            }),
            dismissMs,
          });
        },
      });
    },
  },

  // —— Import ——
  {
    id: "import-library",
    group: "Import",
    buttonLabel: "Library import",
    source: "libraryImport.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 8,
        replaced: 2,
        skipped: 2,
        failed: 0,
        errors: [],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample library import",
        result,
      );
      void runInBackground({
        key: "library-import",
        label: t("toasts:import.library"),
        cancellable: true,
        progressDisplay: "bar",
        run: async (ctx) => {
          ctx.setLabel(t("toasts:import.scanning"));
          await sleep(500);
          ctx.setLabel(t("toasts:import.readingMetadata", { count: 12 }));
          for (let i = 1; i <= 12; i++) {
            if (ctx.isCancelRequested()) {
              throw new BackgroundTaskCancelledError(
                t("toasts:import.cancelled"),
                { dismissMs },
              );
            }
            ctx.setProgress(i, 12);
            await sleep(60);
          }
          ctx.clearProgress();
          ctx.setLabel(t("toasts:import.importing", { count: 12 }));
          for (let i = 1; i <= 12; i++) {
            if (ctx.isCancelRequested()) {
              throw new BackgroundTaskCancelledError(
                t("toasts:import.cancelled"),
                { dismissMs },
              );
            }
            ctx.setProgress(i, 12);
            await sleep(80);
          }
          ctx.settleAs({
            ...importCompletionSettleOptions(result, operationId),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "import-clean",
    group: "Import",
    buttonLabel: "Import · clean (title only)",
    source: "libraryImport.ts",
    fire: (ctx) => {
      fireImportOutcome(ctx, {
        result: {
          imported: 12,
          replaced: 0,
          skipped: 0,
          failed: 0,
          errors: [],
        },
        operationId: "toast-lab-import-clean",
      });
    },
  },
  {
    id: "import-replace-skip",
    group: "Import",
    buttonLabel: "Import · replace/skip only",
    source: "libraryImport.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 0,
        replaced: 5,
        skipped: 3,
        failed: 0,
        errors: [],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample re-import",
        result,
      );
      fireImportOutcome(ctx, { result, operationId });
    },
  },
  {
    id: "import-one-fail",
    group: "Import",
    buttonLabel: "Import · partial (1 fail)",
    source: "libraryImport.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 3,
        replaced: 0,
        skipped: 0,
        failed: 1,
        errors: ["Track X: Permission denied"],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample import one-fail",
        result,
      );
      fireImportOutcome(ctx, { result, operationId });
    },
  },
  {
    id: "import-multi-fail",
    group: "Import",
    buttonLabel: "Import · partial (2+ fails)",
    source: "libraryImport.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 2,
        replaced: 0,
        skipped: 0,
        failed: 2,
        errors: ["Track X: Permission denied", "Track Y: File not found"],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample import multi-fail",
        result,
      );
      fireImportOutcome(ctx, { result, operationId });
    },
  },
  {
    id: "import-all-fail",
    group: "Import",
    buttonLabel: "Import · all failed",
    source: "libraryImport.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 0,
        replaced: 0,
        skipped: 0,
        failed: 3,
        errors: [
          "Track A: Permission denied",
          "Track B: File not found",
          "Track C: Disk full",
        ],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample import all-failed",
        result,
      );
      fireImportOutcome(ctx, { result, operationId });
    },
  },
  {
    id: "import-no-audio",
    group: "Import",
    buttonLabel: "Import · no audio",
    source: "libraryImport.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "library-import",
        label: t("toasts:import.library"),
        progressDisplay: "bar",
        run: async (ctx) => {
          ctx.setLabel(t("toasts:import.scanning"));
          await sleep(500);
          ctx.settleAs({
            ...importNoAudioSettleOptions(),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "import-cd",
    group: "Import",
    buttonLabel: "CD import · success",
    source: "cdImport.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 5,
        replaced: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample CD import",
        result,
      );
      fireCdImportOutcome(ctx, { result, operationId });
    },
  },
  {
    id: "import-cd-skip",
    group: "Import",
    buttonLabel: "CD import · skipped",
    source: "cdImport.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 0,
        replaced: 0,
        skipped: 5,
        failed: 0,
        errors: [],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample CD import skipped",
        result,
      );
      fireCdImportOutcome(ctx, { result, operationId, skipRip: true });
    },
  },
  {
    id: "import-cd-partial",
    group: "Import",
    buttonLabel: "CD import · partial (1 fail)",
    source: "cdImport.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 4,
        replaced: 0,
        skipped: 0,
        failed: 1,
        errors: ["Disorder couldn't be ripped"],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample CD import one-fail",
        result,
      );
      fireCdImportOutcome(ctx, { result, operationId });
    },
  },
  {
    id: "import-cd-all-fail",
    group: "Import",
    buttonLabel: "CD import · all failed",
    source: "cdImport.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const result: ImportLabResult = {
        imported: 0,
        replaced: 0,
        skipped: 0,
        failed: 3,
        errors: [
          "Track 1 couldn't be ripped",
          "Track 2 couldn't be ripped",
          "Track 3 couldn't be ripped",
        ],
      };
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: sample CD import all-failed",
        result,
      );
      fireCdImportOutcome(ctx, { result, operationId });
    },
  },
  {
    id: "import-cd-failed",
    group: "Import",
    buttonLabel: "CD import → failed",
    source: "cdImport.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.import,
        operationId,
        "Toast Lab: CD import failed",
        { error: "drive disappeared" },
        "error",
      );
      void runInBackground({
        key: "cd-import",
        label: t("toasts:import.cd"),
        cancellable: true,
        progressDisplay: "bar",
        run: async (ctx) => {
          ctx.setLabel(t("toasts:import.checkingDuplicates"));
          await sleep(400);
          ctx.setDetail(t("toasts:import.fetchingArt"));
          await sleep(500);
          ctx.settleAs({
            ...cdImportFailedSettleOptions({ logLink: { operationId } }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "import-cd-cancelled",
    group: "Import",
    buttonLabel: "CD import · cancelled",
    source: "cdImport.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "cd-import",
        label: t("toasts:import.cd"),
        cancellable: true,
        progressDisplay: "bar",
        run: async (ctx) => {
          ctx.setLabel(t("toasts:import.cd"));
          ctx.setDetail(t("toasts:progress.trackOf", { current: 2, total: 8 }));
          ctx.setProgress(1, 8);
          await sleep(700);
          throw new BackgroundTaskCancelledError(t("toasts:import.cancelled"), {
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "cd-hero-art",
    group: "Import",
    buttonLabel: "CD album art · fetched",
    source: "cdMetadataFetch.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "cd-hero-art-lab",
        label: t("toasts:cdMetadata.fetchingArt"),
        run: async (ctx) => {
          await sleep(700);
          ctx.settleAs({
            ...cdHeroArtFetchedSettleOptions({ album: "Unknown Pleasures" }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "cd-metadata",
    group: "Import",
    buttonLabel: "CD metadata lookup · found",
    source: "cdMetadataFetch.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "cd-metadata-lab",
        label: t("toasts:cdMetadata.lookingUp"),
        run: async (ctx) => {
          await sleep(700);
          ctx.setDetail(t("toasts:cdMetadata.fetchingArt"));
          await sleep(800);
          ctx.clearDetail();
          ctx.settleAs({
            ...cdMetadataFoundSettleOptions({ album: "Unknown Pleasures" }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "cd-metadata-none",
    group: "Import",
    buttonLabel: "CD metadata lookup · not found",
    source: "cdMetadataFetch.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "cd-metadata-lab",
        label: t("toasts:cdMetadata.lookingUp"),
        run: async (ctx) => {
          await sleep(700);
          ctx.settleAs({
            ...cdMetadataNotFoundSettleOptions(),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "cd-metadata-failed",
    group: "Import",
    buttonLabel: "CD metadata lookup → failed",
    source: "cdMetadataFetch.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.musicbrainz,
        operationId,
        "Toast Lab: MusicBrainz lookup request failed",
        { error: "timed out" },
        "error",
      );
      void runInBackground({
        key: "cd-metadata-lab",
        label: t("toasts:cdMetadata.lookingUp"),
        run: async (ctx) => {
          await sleep(700);
          ctx.settleAs({
            ...cdMetadataFailedSettleOptions({ logLink: { operationId } }),
            dismissMs,
          });
        },
      });
    },
  },
  // —— Convert ——
  {
    id: "convert-ok",
    group: "Convert",
    buttonLabel: "Convert · success",
    source: "convertTracks.ts",
    fire: (ctx) => {
      fireConvertOutcome(ctx, {
        total: 3,
        converted: 3,
        failed: 0,
        errors: [],
        operationId: "toast-lab-convert-ok",
      });
    },
  },
  {
    id: "convert-partial",
    group: "Convert",
    buttonLabel: "Convert · partial (1 fail)",
    source: "convertTracks.ts",
    fire: (ctx) => {
      fireConvertOutcome(ctx, {
        total: 2,
        converted: 1,
        failed: 1,
        errors: ["Song B: Encoder failed"],
        operationId: "toast-lab-convert-partial",
      });
    },
  },
  {
    id: "convert-partial-multi",
    group: "Convert",
    buttonLabel: "Convert · partial (2+ fails)",
    source: "convertTracks.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const errors = ["Song B: Encoder failed", "Song C: Permission denied"];
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.convert,
        operationId,
        "Toast Lab: sample convert summary",
        {
          converted: 8,
          failed: 2,
          errors,
        },
      );
      fireConvertOutcome(ctx, {
        total: 10,
        converted: 8,
        failed: 2,
        errors,
        operationId,
        stepMs: 150,
      });
    },
  },
  {
    id: "convert-failed-one",
    group: "Convert",
    buttonLabel: "Convert · all failed (1)",
    source: "convertTracks.ts",
    fire: (ctx) => {
      fireConvertOutcome(ctx, {
        total: 1,
        converted: 0,
        failed: 1,
        errors: ["Song A: Encoder failed"],
        operationId: "toast-lab-convert-failed-one",
      });
    },
  },
  {
    id: "convert-failed",
    group: "Convert",
    buttonLabel: "Convert · all failed (2+)",
    source: "convertTracks.ts",
    fire: async (ctx) => {
      const operationId = createOperationId();
      const errors = [
        "Song A: Encoder failed",
        "Song B: Encoder failed",
        "Song C: Permission denied",
      ];
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.convert,
        operationId,
        "Toast Lab: sample convert all-failed",
        { converted: 0, failed: 3, errors },
      );
      fireConvertOutcome(ctx, {
        total: 3,
        converted: 0,
        failed: 3,
        errors,
        operationId,
      });
    },
  },

  // —— Updates ——
  {
    id: "updates-checking",
    group: "Updates",
    buttonLabel: "Checking…",
    source: "useUpdaterStore.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "updater",
        label: t("common:updates.checking"),
        run: async (ctx) => {
          await sleep(1000);
          ctx.settleAs({
            status: "success",
            label: t("common:updates.upToDate"),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "updates-available",
    group: "Updates",
    buttonLabel: "Available + actions",
    source: "useUpdaterStore.ts",
    fire: ({ showToast }) => {
      showToast(
        availableUpdatePayload(
          TOAST_LAB_UPDATE_VERSION,
          toastLabUpdateAvailableActions(),
          {
            dismissMs: null,
          },
        ),
      );
    },
  },
  {
    id: "updates-available-simulated",
    group: "Updates",
    buttonLabel: "Available (simulated)",
    source: "useUpdaterStore.ts",
    fire: ({ showToast }) => {
      showToast(
        availableUpdatePayload(
          TOAST_LAB_UPDATE_VERSION,
          toastLabUpdateAvailableActions(),
          {
            dismissMs: null,
            simulated: true,
          },
        ),
      );
    },
  },
  {
    id: "updates-download",
    group: "Updates",
    buttonLabel: "Downloading…",
    source: "useUpdaterStore.ts",
    fire: ({ runInBackground, sleep }) => {
      void runInBackground({
        key: "updater-install",
        label: t("common:updates.downloading"),
        progressDisplay: "bar",
        run: async (ctx) => {
          for (let i = 1; i <= 20; i++) {
            ctx.setProgress(i, 20);
            await sleep(100);
          }
          ctx.dismissSilently();
        },
      });
    },
  },
  {
    id: "updates-error",
    group: "Updates",
    buttonLabel: "Check error",
    source: "useUpdaterStore.ts",
    fire: ({ showErrorToast, dismissMs }) => {
      showErrorToast(
        updaterCheckErrorPayload("network offline (simulated)", { dismissMs }),
      );
    },
  },

  // —— Spiral Card ——
  {
    id: "spcard-installed",
    group: "Spiral Card",
    buttonLabel: "Installed",
    source: "spcardInstall.ts",
    fire: ({ showToast, dismissMs }) => {
      showToast(spiralCardInstallSuccessPayload(false, { dismissMs }));
    },
  },
  {
    id: "spcard-replaced",
    group: "Spiral Card",
    buttonLabel: "Replaced",
    source: "spcardInstall.ts",
    fire: ({ showToast, dismissMs }) => {
      showToast(spiralCardInstallSuccessPayload(true, { dismissMs }));
    },
  },
  {
    id: "spcard-finalize",
    group: "Spiral Card",
    buttonLabel: "Finalized",
    source: "SpiralCardModal.tsx",
    fire: ({ showToast, dismissMs }) => {
      showToast(spiralCardFinalizedPayload({ dismissMs }));
    },
  },
  {
    id: "spcard-finalize-fail",
    group: "Spiral Card",
    buttonLabel: "Finalize failed",
    source: "SpiralCardModal.tsx",
    fire: ({ showErrorToast, dismissMs }) => {
      showErrorToast(
        spiralCardFinalizeNetworkErrorPayload(true, { dismissMs }),
      );
    },
  },

  // —— Packs & themes ——
  {
    id: "pack-install",
    group: "Packs & themes",
    buttonLabel: "Pack installed (file)",
    source: "refreshPackStores.ts",
    fire: ({ showToast, dismissMs }) => {
      showToast(packInstalledPayload("Example Pack", "1.2.0", { dismissMs }));
    },
  },
  {
    id: "pack-install-fail",
    group: "Packs & themes",
    buttonLabel: "Pack install failed (file)",
    source: "refreshPackStores.ts",
    fire: async ({ showErrorToast, dismissMs }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.packInstall,
        operationId,
        "Toast Lab: pack install failed for Example Pack: sample corrupt archive",
        {
          source: "file",
          name: "Example Pack",
          error: "sample corrupt archive",
        },
        "error",
      );
      showErrorToast(
        packInstallFailedPayload({
          dismissMs,
          logLink: { operationId },
        }),
      );
    },
  },
  {
    id: "pack-download-ok",
    group: "Packs & themes",
    buttonLabel: "Registry download → installed",
    source: "packRegistry.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: "pack-registry-download",
        label: t("toasts:packs.downloading", { name: "Xbox" }),
        progressDisplay: "bar",
        run: async (ctx) => {
          for (let i = 1; i <= 8; i++) {
            ctx.setProgress(i, 8);
            await sleep(120);
          }
          ctx.settleAs({
            status: "success",
            label: t("toasts:packs.installed", {
              name: "Xbox",
              version: "1.0.0",
            }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "pack-download-fail",
    group: "Packs & themes",
    buttonLabel: "Registry download → failed",
    source: "packRegistry.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.packInstall,
        operationId,
        "Toast Lab: pack download failed for Xbox: could not download pack (http://127.0.0.1:8787/…)",
        {
          source: "registry",
          name: "Xbox",
          registryUrl: "http://127.0.0.1:8787",
          authorId: "spiral",
          packId: "xbox",
          version: "1.0.0",
          error: "could not download pack (http://127.0.0.1:8787/…)",
        },
        "error",
      );
      void runInBackground({
        key: "pack-registry-download",
        label: t("toasts:packs.downloading", { name: "Xbox" }),
        progressDisplay: "bar",
        run: async (ctx) => {
          for (let i = 1; i <= 4; i++) {
            ctx.setProgress(i, 10);
            await sleep(120);
          }
          const failed = packDownloadFailedPayload("Xbox", {
            dismissMs,
            logLink: { operationId },
          });
          ctx.settleAs({
            status: "error",
            label: failed.label,
            detail: failed.detail,
            logLink: failed.logLink,
            dismissMs: failed.dismissMs,
          });
        },
      });
    },
  },
  {
    id: "pack-reload",
    group: "Packs & themes",
    buttonLabel: "Packs reloaded",
    source: "refreshPackStores.ts",
    fire: ({ showToast, dismissMs }) => {
      showToast(packReloadedPayload({ dismissMs }));
    },
  },
  {
    id: "pack-updates-ok",
    group: "Packs & themes",
    buttonLabel: "Update all packs → success",
    source: "usePackUpdatesStore.ts",
    fire: ({ runInBackground, dismissMs, sleep }) => {
      void runInBackground({
        key: PACK_UPDATES_BULK_KEY,
        label: t("toasts:packs.updating"),
        progressDisplay: "bar",
        run: async (ctx) => {
          for (let i = 1; i <= 3; i++) {
            ctx.setProgress(i, 3);
            await sleep(100);
          }
          const settle = packUpdatesSettleOptions({
            updated: 3,
            failed: 0,
            errors: [],
            operationId: createOperationId(),
          });
          ctx.settleAs({ ...settle, dismissMs });
        },
      });
    },
  },
  {
    id: "pack-updates-mixed",
    group: "Packs & themes",
    buttonLabel: "Update all packs → mixed",
    source: "usePackUpdatesStore.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.packInstall,
        operationId,
        "Toast Lab: pack update failed for Xbox: sample network error",
        {
          source: "registry",
          name: "Xbox",
          error: "sample network error",
        },
        "error",
      );
      void runInBackground({
        key: PACK_UPDATES_BULK_KEY,
        label: t("toasts:packs.updating"),
        progressDisplay: "bar",
        run: async (ctx) => {
          for (let i = 1; i <= 4; i++) {
            ctx.setProgress(i, 4);
            await sleep(100);
          }
          const settle = packUpdatesSettleOptions({
            updated: 2,
            failed: 1,
            errors: ["Xbox: sample network error"],
            operationId,
          });
          ctx.settleAs({ ...settle, dismissMs });
        },
      });
    },
  },
  {
    id: "pack-updates-fail",
    group: "Packs & themes",
    buttonLabel: "Update all packs → failed",
    source: "usePackUpdatesStore.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.packInstall,
        operationId,
        "Toast Lab: pack updates failed for 2 packs",
        { source: "registry", failed: 2 },
        "error",
      );
      void runInBackground({
        key: PACK_UPDATES_BULK_KEY,
        label: t("toasts:packs.updating"),
        progressDisplay: "bar",
        run: async (ctx) => {
          for (let i = 1; i <= 2; i++) {
            ctx.setProgress(i, 2);
            await sleep(100);
          }
          const settle = packUpdatesSettleOptions({
            updated: 0,
            failed: 2,
            errors: ["Xbox: fail", "T3: fail"],
            operationId,
          });
          ctx.settleAs({ ...settle, dismissMs });
        },
      });
    },
  },
  {
    id: "theme-saved",
    group: "Packs & themes",
    buttonLabel: "Theme saved",
    source: "ThemeEditor.tsx",
    fire: ({ showToast, dismissMs }) => {
      showToast(themeSavedPayload({ dismissMs }));
    },
  },
  {
    id: "theme-deleted",
    group: "Packs & themes",
    buttonLabel: "Theme deleted",
    source: "WorkshopThemeActions.tsx",
    fire: ({ showToast, dismissMs }) => {
      showToast(themeDeletedPayload({ dismissMs }));
    },
  },
  {
    id: "theme-create-fail",
    group: "Packs & themes",
    buttonLabel: "Theme create failed",
    source: "ThemesSection.tsx",
    fire: ({ showErrorToast, dismissMs }) => {
      showErrorToast(themeCreateFailedPayload(undefined, { dismissMs }));
    },
  },

  // —— Diagnostics ——
  {
    id: "view-logs-link",
    group: "Diagnostics",
    buttonLabel: "Error + View logs",
    source: "toastLogLink.ts",
    fire: async ({ runInBackground, dismissMs, sleep }) => {
      const operationId = createOperationId();
      const errorLines = ["Song A: timeout", "Song B: not_found"];
      await seedToastLabLog(
        ACTIVITY_LOG_DOMAINS.lyricsFetch,
        operationId,
        "Toast Lab: sample lyrics fetch summary",
        {
          failed: 2,
          found: 0,
          errors: errorLines,
          tracks: [
            { title: "Song A", status: "failed", reason: "timeout" },
            { title: "Song B", status: "failed", reason: "not_found" },
          ],
        },
      );
      void runInBackground({
        key: "lyrics-fetch-bulk",
        label: t("toasts:lyrics.fetching"),
        progressDisplay: "bar",
        run: async (ctx) => {
          await sleep(200);
          ctx.settleAs({
            ...lyricsFetchBulkSettleOptions({
              tally: {
                found: 0,
                notFound: 0,
                ambiguous: 0,
                failed: 2,
              },
              errorLines,
              operationId,
            }),
            dismissMs,
          });
        },
      });
    },
  },
  {
    id: "activity-copied",
    group: "Diagnostics",
    buttonLabel: "Activity lines copied",
    source: "activityLogToast.ts",
    fire: ({ showToast, dismissMs }) => {
      const payload = activityLogCopiedPayload(12, { dismissMs });
      if (payload) showToast(payload);
    },
  },
  {
    id: "diagnostics-copied",
    group: "Diagnostics",
    buttonLabel: "Logs copied",
    source: "diagnosticsExport.ts",
    fire: ({ showToast, dismissMs }) => {
      showToast(diagnosticsCopiedPayload({ dismissMs }));
    },
  },
  {
    id: "diagnostics-saved",
    group: "Diagnostics",
    buttonLabel: "Exported to file",
    source: "diagnosticsExport.ts",
    fire: ({ showToast, dismissMs }) => {
      showToast(
        diagnosticsSavedPayload("spiral-diagnostics.json", { dismissMs }),
      );
    },
  },
];

export function toastLabScenarioGroups(
  scenarios: ToastLabScenario[] = TOAST_LAB_SCENARIOS,
): { group: string; scenarios: ToastLabScenario[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, ToastLabScenario[]>();
  for (const scenario of scenarios) {
    if (!byGroup.has(scenario.group)) {
      order.push(scenario.group);
      byGroup.set(scenario.group, []);
    }
    byGroup.get(scenario.group)!.push(scenario);
  }
  return order.map((group) => ({
    group,
    scenarios: byGroup.get(group)!,
  }));
}
