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
import type { CoverArtCandidate } from "../types/coverArt";

async function cacheBestCoverArtCandidate(
  candidates: Awaited<ReturnType<typeof fetchCoverArt>>,
  cacheLabel: string,
): Promise<string | null> {
  const best = candidates[0];
  if (!best?.url) return null;
  return cacheArtFromUrl(best.url, cacheLabel);
}

/**
 * Prefer Cover Art Archive for a known release MBID; fall back to
 * artist/album MusicBrainz search when MBID is missing or yields nothing.
 */
export async function fetchCoverArtCandidates(options: {
  artist: string;
  album: string;
  releaseMbid?: string | null;
  logContext?: ActivityLogContext;
}): Promise<CoverArtCandidate[]> {
  const releaseMbid = options.releaseMbid?.trim() || null;
  if (releaseMbid) {
    const byRelease = await fetchCoverArtForRelease(
      releaseMbid,
      options.logContext,
    );
    if (byRelease.length > 0) {
      return byRelease;
    }
  }
  return fetchCoverArt(options.artist, options.album, options.logContext);
}

/** Cache the best cover, preferring a known release MBID over title search. */
export async function fetchAlbumArtPreferringRelease(options: {
  artist: string;
  album: string;
  releaseMbid?: string | null;
  cacheLabel: string;
  logContext?: ActivityLogContext;
}): Promise<string | null> {
  const releaseMbid = options.releaseMbid?.trim() || null;
  if (releaseMbid) {
    const artPath = await fetchAlbumArtForRelease(
      releaseMbid,
      options.cacheLabel,
      options.logContext,
    );
    if (artPath) return artPath;
  }
  return fetchAlbumArtPath(options.artist, options.album, options.logContext);
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
