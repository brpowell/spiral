import {
  fetchAlbumArtPreferringRelease,
  resolveAlbumArtPath,
} from "./albumArtFetch";
import { ensureCdHeroArtValid } from "./cdArt";
import { createOperationId, logActivity, withLogContext } from "./activityLog";
import { t } from "./i18n";
import { isNetworkLikelyAvailable } from "./network";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useCdStore } from "../store/useCdStore";
import type { ActivityLogContext } from "../types/activityLog";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

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

function buildLogContext(
  driveId: string,
  operationId: string,
): ActivityLogContext {
  const disc = useCdStore.getState().discsByDriveId[driveId];
  return {
    operationId,
    driveId,
    discId: disc?.discId ?? undefined,
  };
}

async function resolveCdHeroArtCachePath(
  driveId: string,
  logContext?: ActivityLogContext,
): Promise<string | null> {
  const query = resolveCdHeroArtQuery(driveId);
  if (!query) return null;
  const context = withLogContext(logContext, {
    artist: query.artist,
    album: query.album,
    releaseMbid: query.releaseMbid ?? undefined,
  });
  return resolveAlbumArtPath(`${query.artist} - ${query.album}`, context);
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
    operationId: logContext?.operationId,
    context: logContext,
  });
  return true;
}

async function fetchAndSetHeroArt(
  driveId: string,
  logContext?: ActivityLogContext,
): Promise<void> {
  const query = resolveCdHeroArtQuery(driveId);
  if (!query) {
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Skipped hero art fetch: missing artist or album",
      operationId: logContext?.operationId,
      context: logContext,
    });
    return;
  }

  const context = withLogContext(logContext, {
    artist: query.artist,
    album: query.album,
    releaseMbid: query.releaseMbid ?? undefined,
  });

  const cacheLabel = `${query.artist} - ${query.album}`;
  let artPath = await resolveAlbumArtPath(cacheLabel, context);

  if (!artPath) {
    // Also covers startCdMetadataFetch when the lookup failed and left no metadata.
    if (skipRemoteHeroArtWithoutMetadata(driveId, context)) {
      return;
    }

    if (!isNetworkLikelyAvailable()) {
      logActivity({
        level: "warn",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message:
          "Skipped hero art fetch: network unavailable and no local cache",
        operationId: logContext?.operationId,
        context: logContext,
      });
      return;
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
    logActivity({
      level: "info",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Hero art cached for CD",
      operationId: context.operationId,
      context,
      details: { artPath },
    });
  } else {
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "No hero art found for CD",
      operationId: context.operationId,
      context,
    });
  }
}

export function startCdHeroArtFetch(driveId: string): void {
  if (!resolveCdHeroArtQuery(driveId)) return;

  const operationId = createOperationId();
  const logContext = buildLogContext(driveId, operationId);

  void (async () => {
    const existing = await ensureCdHeroArtValid(driveId);
    if (existing) return;

    const cachedPath = await resolveCdHeroArtCachePath(driveId, logContext);
    if (cachedPath) {
      useCdStore.getState().setHeroArt(driveId, cachedPath);
      return;
    }

    // Require MB metadata before network fetch (CD-Text alone is not consent).
    if (skipRemoteHeroArtWithoutMetadata(driveId, logContext)) {
      return;
    }

    logActivity({
      level: "info",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Starting CD hero art fetch",
      operationId,
      context: logContext,
    });

    useBackgroundTasksStore.getState().runInBackground({
      key: `cd-hero-art-${driveId}`,
      label: t("toasts:cdMetadata.fetchingArt"),
      run: async () => {
        await fetchAndSetHeroArt(driveId, logContext);
      },
    });
  })();
}

export function startCdMetadataFetch(driveId: string): void {
  const operationId = createOperationId();
  const logContext = buildLogContext(driveId, operationId);

  logActivity({
    level: "info",
    domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
    message: "Starting CD metadata fetch",
    operationId,
    context: logContext,
  });

  useBackgroundTasksStore.getState().runInBackground({
    key: `cd-metadata-${driveId}`,
    label: t("toasts:cdMetadata.lookingUp"),
    run: async (ctx) => {
      try {
        await useCdStore.getState().loadDiscMetadata(driveId, {
          force: true,
          logContext,
        });

        const needsRemoteArt =
          (await resolveCdHeroArtCachePath(driveId, logContext)) == null;
        if (needsRemoteArt) {
          ctx.setDetail(t("toasts:cdMetadata.fetchingArt"));
        }
        await fetchAndSetHeroArt(driveId, logContext);
        ctx.clearDetail();

        logActivity({
          level: "info",
          domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
          message: "CD metadata fetch completed",
          operationId,
          context: logContext,
        });
      } catch (err) {
        logActivity({
          level: "error",
          domain: ACTIVITY_LOG_DOMAINS.musicbrainz,
          message: "CD metadata fetch failed",
          operationId,
          context: logContext,
          details: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
        throw err;
      }
    },
  });
}
