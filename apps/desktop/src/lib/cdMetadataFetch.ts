import {
  fetchAlbumArtPreferringRelease,
  resolveAlbumArtPath,
} from "./albumArtFetch";
import { ensureCdHeroArtValid } from "./cdArt";
import { logActivity, withLogContext } from "./activityLog";
import { t } from "./i18n";
import { isNetworkLikelyAvailable } from "./network";
import { resolveCachedArtPath } from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useCdStore } from "../store/useCdStore";
import type { ActivityLogContext } from "../types/activityLog";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";
import { selectedDiscFromLookup } from "./cdMetadata";
import {
  cdHeroArtFetchedSettleOptions,
  cdMetadataFailedSettleOptions,
  cdMetadataFoundSettleOptions,
  cdMetadataNotFoundSettleOptions,
} from "./toastPayloads";

function cdMetadataTaskKey(driveId: string): string {
  return `cd-metadata-${driveId}`;
}

function resolveCdHeroArtQuery(
  driveId: string,
): { artist: string; album: string; releaseMbid?: string | null } | null {
  const metadata = useCdStore.getState().metadataByDriveId[driveId];
  const disc = useCdStore.getState().discsByDriveId[driveId];
  const album = metadata?.album?.trim() || disc?.album?.trim();
  const artist =
    metadata?.albumArtist?.trim() ||
    disc?.artist?.trim() ||
    metadata?.tracks[0]?.artist?.trim();
  if (!artist || !album) return null;
  return { artist, album, releaseMbid: metadata?.releaseMbid };
}

function buildLogContext(driveId: string): ActivityLogContext {
  const disc = useCdStore.getState().discsByDriveId[driveId];
  return {
    driveId,
    discId: disc?.discId ?? undefined,
  };
}

async function resolveCdHeroArtCachePath(
  driveId: string,
  logContext?: ActivityLogContext,
  options?: { log?: boolean },
): Promise<string | null> {
  const query = resolveCdHeroArtQuery(driveId);
  if (!query) return null;
  const cacheLabel = `${query.artist} - ${query.album}`;
  if (options?.log) {
    const context = withLogContext(logContext, {
      artist: query.artist,
      album: query.album,
      releaseMbid: query.releaseMbid ?? undefined,
    });
    return resolveAlbumArtPath(cacheLabel, context);
  }
  return resolveCachedArtPath(cacheLabel);
}

/** Remote cover-art lookup follows MusicBrainz metadata consent — not CD-Text alone. */
function hasDiscMetadata(driveId: string): boolean {
  return useCdStore.getState().metadataByDriveId[driveId] != null;
}

function skipRemoteHeroArtWithoutMetadata(
  driveId: string,
  logContext?: ActivityLogContext,
): boolean {
  if (hasDiscMetadata(driveId)) return false;
  logActivity({
    level: "info",
    domain: ACTIVITY_LOG_DOMAINS.coverArt,
    message:
      "Skipped CD hero art network fetch: no MusicBrainz metadata (user may have declined)",
    context: logContext,
  });
  return true;
}

async function fetchAndSetHeroArt(
  driveId: string,
  logContext?: ActivityLogContext,
): Promise<boolean> {
  const query = resolveCdHeroArtQuery(driveId);
  if (!query) {
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Skipped hero art fetch: missing artist or album",
      context: logContext,
    });
    return false;
  }

  const context = withLogContext(logContext, {
    artist: query.artist,
    album: query.album,
    releaseMbid: query.releaseMbid ?? undefined,
  });

  const cacheLabel = `${query.artist} - ${query.album}`;
  let artPath = await resolveAlbumArtPath(cacheLabel, context);

  if (!artPath) {
    if (skipRemoteHeroArtWithoutMetadata(driveId, context)) {
      return false;
    }

    if (!isNetworkLikelyAvailable()) {
      logActivity({
        level: "warn",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message:
          "Skipped hero art fetch: network unavailable and no local cache",
        context: logContext,
      });
      return false;
    }

    artPath = await fetchAlbumArtPreferringRelease({
      artist: query.artist,
      album: query.album,
      releaseMbid: query.releaseMbid,
      cacheLabel,
      logContext: context,
    });
  }

  if (artPath) {
    useCdStore.getState().setHeroArt(driveId, artPath);
    return true;
  }

  logActivity({
    level: "warn",
    domain: ACTIVITY_LOG_DOMAINS.coverArt,
    message: "No hero art found for CD",
    context,
  });
  return false;
}

/** The metadata fetch fetches hero art itself, so a separate art task would duplicate it. */
function isMetadataFetchRunning(driveId: string): boolean {
  const key = cdMetadataTaskKey(driveId);
  return useBackgroundTasksStore
    .getState()
    .tasks.some((task) => task.key === key && task.status === "running");
}

export function startCdHeroArtFetch(driveId: string): void {
  const query = resolveCdHeroArtQuery(driveId);
  if (!query || isMetadataFetchRunning(driveId)) return;

  const logContext = buildLogContext(driveId);

  void (async () => {
    const existing = await ensureCdHeroArtValid(driveId);
    if (existing) return;

    const cachedPath = await resolveCdHeroArtCachePath(driveId, logContext, {
      log: true,
    });
    if (cachedPath) {
      useCdStore.getState().setHeroArt(driveId, cachedPath);
      return;
    }

    // Re-check: a metadata fetch may have started while awaiting above.
    if (isMetadataFetchRunning(driveId)) return;

    // Require MB metadata before network fetch (CD-Text alone is not consent).
    if (skipRemoteHeroArtWithoutMetadata(driveId, logContext)) {
      return;
    }

    useBackgroundTasksStore.getState().runInBackground({
      key: `cd-hero-art-${driveId}`,
      label: t("toasts:cdMetadata.fetchingArt"),
      run: async (ctx) => {
        const applied = await fetchAndSetHeroArt(driveId, logContext);
        if (applied) {
          ctx.settleAs(cdHeroArtFetchedSettleOptions({ album: query.album }));
          return;
        }
        ctx.dismissSilently();
      },
    });
  })();
}

export function startCdMetadataFetch(driveId: string): void {
  const logContext = buildLogContext(driveId);

  useBackgroundTasksStore.getState().runInBackground({
    key: cdMetadataTaskKey(driveId),
    label: t("toasts:cdMetadata.lookingUp"),
    run: async (ctx) => {
      try {
        const lookup = await useCdStore.getState().loadDiscMetadata(driveId, {
          force: true,
          logContext,
        });

        if (!lookup) {
          ctx.dismissSilently();
          return;
        }

        if (lookup.kind === "error") {
          ctx.settleAs(cdMetadataFailedSettleOptions({ logLink: true }));
          return;
        }

        if (lookup.kind === "miss" || lookup.candidates.length === 0) {
          ctx.settleAs(cdMetadataNotFoundSettleOptions());
          return;
        }

        const selected = selectedDiscFromLookup(lookup);
        if (selected) {
          const needsRemoteArt =
            (await resolveCdHeroArtCachePath(driveId, logContext)) == null;
          if (needsRemoteArt) {
            ctx.setDetail(t("toasts:cdMetadata.fetchingArt"));
          }
          await fetchAndSetHeroArt(driveId, logContext);
          ctx.clearDetail();
        }

        ctx.settleAs(cdMetadataFoundSettleOptions({ album: selected?.album }));
      } catch (err) {
        logActivity({
          level: "error",
          domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
          message: "CD metadata fetch failed",
          context: logContext,
          details: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
        ctx.settleAs(cdMetadataFailedSettleOptions({ logLink: true }));
      }
    },
  });
}
