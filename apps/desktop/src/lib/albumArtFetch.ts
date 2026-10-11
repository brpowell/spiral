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

type CachedCoverArt = {
  path: string;
  byteCount: number;
  candidate: CoverArtCandidate;
  candidateCount: number;
};

function isCdAutoCoverArtFetch(logContext?: ActivityLogContext): boolean {
  return logContext?.driveId != null;
}

function coverArtQueryUrl(options: {
  artist: string;
  album: string;
  releaseMbid?: string | null;
}): string {
  const mbid = options.releaseMbid?.trim();
  if (mbid) {
    // Release path also queries CAA /release-group after resolving the RG id.
    return `https://coverartarchive.org/release/${mbid}`;
  }
  const query = `releasegroup:"${options.album.replace(/"/g, '\\"')}" AND artist:"${options.artist.replace(/"/g, '\\"')}"`;
  return `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
}

function logCoverArtWarn(
  logContext: ActivityLogContext | undefined,
  message: string,
  contextPatch: ActivityLogContext,
): void {
  if (isCdAutoCoverArtFetch(logContext)) return;
  logActivity({
    level: "warn",
    domain: ACTIVITY_LOG_DOMAINS.coverArt,
    message,
    operationId: logContext?.operationId,
    context: withLogContext(logContext, contextPatch),
  });
}

function logCdCoverArtFetchStart(options: {
  artist: string;
  album: string;
  releaseMbid?: string | null;
  logContext?: ActivityLogContext;
}): void {
  const releaseMbid = options.releaseMbid?.trim() || undefined;
  logActivity({
    level: "info",
    domain: ACTIVITY_LOG_DOMAINS.coverArt,
    message: `Fetching cover art for CD '${options.album}'`,
    operationId: options.logContext?.operationId,
    context: options.logContext,
    details: {
      ...(releaseMbid != null ? { releaseMbid } : {}),
      queryUrl: coverArtQueryUrl({
        artist: options.artist,
        album: options.album,
        releaseMbid,
      }),
      ...(options.logContext?.driveId != null
        ? { driveId: options.logContext.driveId }
        : {}),
      ...(options.logContext?.discId != null
        ? { discId: options.logContext.discId }
        : {}),
    },
  });
}

function logCdCoverArtFetched(
  album: string,
  logContext: ActivityLogContext | undefined,
  cached: CachedCoverArt,
): void {
  const selected = cached.candidate;
  logActivity({
    level: "info",
    domain: ACTIVITY_LOG_DOMAINS.coverArt,
    message: `Cover art fetched for '${album}'`,
    operationId: logContext?.operationId,
    context: logContext,
    details: {
      byteCount: cached.byteCount,
      imageUrl: selected.url,
      cachePath: cached.path,
      candidateCount: cached.candidateCount,
      canonicalRank: selected.canonicalRank,
      ...(selected.width != null ? { width: selected.width } : {}),
      ...(selected.height != null ? { height: selected.height } : {}),
    },
  });
}

async function cacheBestCoverArtCandidate(
  candidates: Awaited<ReturnType<typeof fetchCoverArt>>,
  cacheLabel: string,
  logContext?: ActivityLogContext,
): Promise<CachedCoverArt | null> {
  const best = candidates[0];
  if (!best?.url) return null;
  const cached = await cacheArtFromUrl(best.url, cacheLabel, logContext);
  return {
    path: cached.path,
    byteCount: cached.byteCount,
    candidate: best,
    candidateCount: candidates.length,
  };
}

async function cacheAndLogCoverArt(
  candidates: CoverArtCandidate[],
  cacheLabel: string,
  logContext: ActivityLogContext | undefined,
  album: string,
  emptyMessage: string,
  cacheFailedMessage: string,
  contextPatch: ActivityLogContext,
): Promise<string | null> {
  if (candidates.length === 0) {
    logCoverArtWarn(logContext, emptyMessage, contextPatch);
    return null;
  }

  const cached = await cacheBestCoverArtCandidate(
    candidates,
    cacheLabel,
    logContext,
  );
  if (!cached) {
    logCoverArtWarn(logContext, cacheFailedMessage, contextPatch);
    return null;
  }

  if (isCdAutoCoverArtFetch(logContext)) {
    logCdCoverArtFetched(logContext?.album ?? album, logContext, cached);
  }
  return cached.path;
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
  const logContext = options.logContext
    ? withLogContext(options.logContext, {
        artist: options.artist,
        album: options.album,
        ...(releaseMbid != null ? { releaseMbid } : {}),
      })
    : undefined;

  if (isCdAutoCoverArtFetch(logContext)) {
    logCdCoverArtFetchStart({
      artist: options.artist,
      album: options.album,
      releaseMbid,
      logContext,
    });
  }

  if (releaseMbid) {
    const artPath = await fetchAlbumArtForRelease(
      releaseMbid,
      options.cacheLabel,
      logContext,
    );
    if (artPath) return artPath;
  }
  return fetchAlbumArtPath(options.artist, options.album, logContext);
}

function discScopedLogContext(
  logContext?: ActivityLogContext,
): ActivityLogContext | undefined {
  if (logContext?.driveId == null && logContext?.discId == null) {
    return undefined;
  }
  return {
    ...(logContext.driveId != null ? { driveId: logContext.driveId } : {}),
    ...(logContext.discId != null ? { discId: logContext.discId } : {}),
  };
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
        message: "Resolved CD cover art from local cache",
        context: discScopedLogContext(logContext),
        details: {
          ...(logContext?.releaseMbid != null
            ? { releaseMbid: logContext.releaseMbid }
            : {}),
          artPath,
          cacheLabel,
        },
      });
    }
    return artPath;
  } catch (err) {
    logActivity({
      level: "warn",
      domain: ACTIVITY_LOG_DOMAINS.coverArt,
      message: "Failed to resolve cached album art",
      context: discScopedLogContext(logContext),
      details: {
        ...(logContext?.releaseMbid != null
          ? { releaseMbid: logContext.releaseMbid }
          : {}),
        cacheLabel,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return null;
  }
}

async function fetchAlbumArtForRelease(
  releaseMbid: string,
  cacheLabel: string,
  logContext?: ActivityLogContext,
): Promise<string | null> {
  if (!isNetworkLikelyAvailable()) {
    logCoverArtWarn(
      logContext,
      "Skipped cover art fetch: network unavailable",
      {
        releaseMbid,
      },
    );
    return null;
  }

  try {
    const candidates = await fetchCoverArtForRelease(releaseMbid, logContext);
    return cacheAndLogCoverArt(
      candidates,
      cacheLabel,
      logContext,
      logContext?.album ?? "",
      "No cover art candidates for release",
      "Failed to cache cover art for release",
      { releaseMbid },
    );
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

async function fetchAlbumArtPath(
  artist: string,
  album: string,
  logContext?: ActivityLogContext,
): Promise<string | null> {
  if (!isNetworkLikelyAvailable()) {
    logCoverArtWarn(
      logContext,
      "Skipped cover art fetch: network unavailable",
      {
        artist,
        album,
      },
    );
    return null;
  }

  try {
    const candidates = await fetchCoverArt(artist, album, logContext);
    return cacheAndLogCoverArt(
      candidates,
      `${artist} - ${album}`,
      logContext,
      album,
      "No cover art candidates for artist/album search",
      "Failed to cache cover art from search results",
      { artist, album },
    );
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
