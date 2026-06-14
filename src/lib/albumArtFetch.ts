import { isNetworkLikelyAvailable } from "./network";
import { logActivity, withLogContext } from "./activityLog";
import {
  cacheArtFromUrl,
  fetchCoverArt,
  fetchCoverArtForRelease,
  resolveCachedArtPath,
} from "./tauri";
import type { ActivityLogContext } from "../types/activityLog";
import { ACTIVITY_LOG_DOMAINS } from "../types/activityLog";

async function cacheBestCoverArtCandidate(
  candidates: Awaited<ReturnType<typeof fetchCoverArt>>,
  cacheLabel: string,
): Promise<string | null> {
  const best = candidates[0];
  if (!best?.url) return null;
  return cacheArtFromUrl(best.url, cacheLabel);
}

export async function resolveAlbumArtPath(
  cacheLabel: string,
  logContext?: ActivityLogContext,
): Promise<string | null> {
  try {
    const artPath = await resolveCachedArtPath(cacheLabel);
    if (artPath) {
      logActivity({
        level: "info",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message: "Resolved album art from local cache",
        operationId: logContext?.operationId,
        context: logContext,
        details: { artPath, cacheLabel },
      });
    }
    return artPath;
  } catch (err) {
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Failed to resolve cached album art",
      operationId: logContext?.operationId,
      context: logContext,
      details: {
        cacheLabel,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return null;
  }
}

export async function fetchAlbumArtForRelease(
  releaseMbid: string,
  cacheLabel: string,
  logContext?: ActivityLogContext,
): Promise<string | null> {
  if (!isNetworkLikelyAvailable()) {
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Skipped cover art fetch: network unavailable",
      operationId: logContext?.operationId,
      context: withLogContext(logContext, { releaseMbid }),
    });
    return null;
  }

  try {
    const candidates = await fetchCoverArtForRelease(releaseMbid, logContext);
    if (candidates.length === 0) {
      logActivity({
        level: "warn",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message: "No cover art candidates for release",
        operationId: logContext?.operationId,
        context: withLogContext(logContext, { releaseMbid }),
      });
      return null;
    }

    const artPath = await cacheBestCoverArtCandidate(candidates, cacheLabel);
    if (!artPath) {
      logActivity({
        level: "warn",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message: "Failed to cache cover art for release",
        operationId: logContext?.operationId,
        context: withLogContext(logContext, { releaseMbid }),
      });
    }
    return artPath;
  } catch (err) {
    logActivity({
      level: "error",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Cover art fetch for release failed",
      operationId: logContext?.operationId,
      context: withLogContext(logContext, { releaseMbid }),
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return null;
  }
}

export async function fetchAlbumArtPath(
  artist: string,
  album: string,
  logContext?: ActivityLogContext,
): Promise<string | null> {
  if (!isNetworkLikelyAvailable()) {
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Skipped cover art fetch: network unavailable",
      operationId: logContext?.operationId,
      context: withLogContext(logContext, { artist, album }),
    });
    return null;
  }

  try {
    const candidates = await fetchCoverArt(artist, album, logContext);
    if (candidates.length === 0) {
      logActivity({
        level: "warn",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message: "No cover art candidates for artist/album search",
        operationId: logContext?.operationId,
        context: withLogContext(logContext, { artist, album }),
      });
      return null;
    }

    const artPath = await cacheBestCoverArtCandidate(
      candidates,
      `${artist} - ${album}`,
    );
    if (!artPath) {
      logActivity({
        level: "warn",
        domain: ACTIVITY_LOG_DOMAINS.coverArt,
        message: "Failed to cache cover art from search results",
        operationId: logContext?.operationId,
        context: withLogContext(logContext, { artist, album }),
      });
    }
    return artPath;
  } catch (err) {
    logActivity({
      level: "error",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Cover art search failed",
      operationId: logContext?.operationId,
      context: withLogContext(logContext, { artist, album }),
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return null;
  }
}
