import { invoke } from "@tauri-apps/api/core";
import { assetUrlFromPath } from "./assetUrl";

/** Matches Rust `ROW_THUMB_SIZE` (2× `--track-list-art-size`). */
export const ROW_ART_THUMB_SIZE = 72;

const thumbPathCache = new Map<string, string>();
const pendingThumbs = new Map<string, Promise<string | null>>();

export function resolveRowArtThumbPath(
  artPath: string,
  size = ROW_ART_THUMB_SIZE,
): Promise<string | null> {
  const cached = thumbPathCache.get(artPath);
  if (cached) return Promise.resolve(cached);

  let pending = pendingThumbs.get(artPath);
  if (!pending) {
    pending = invoke<string | null>("ensure_art_row_thumb", { artPath, size }).then(
      (thumbPath) => {
        pendingThumbs.delete(artPath);
        if (thumbPath) thumbPathCache.set(artPath, thumbPath);
        return thumbPath;
      },
    );
    pendingThumbs.set(artPath, pending);
  }

  return pending;
}

export function getCachedRowArtThumbPath(artPath: string): string | null {
  return thumbPathCache.get(artPath) ?? null;
}

export function rowArtAssetUrl(thumbPath: string): string {
  return assetUrlFromPath(thumbPath);
}

export function getCachedRowArtAssetUrl(artPath: string): string | null {
  const thumbPath = getCachedRowArtThumbPath(artPath);
  return thumbPath ? rowArtAssetUrl(thumbPath) : null;
}

const decodedRowArtAssetUrls = new Set<string>();

export function isRowArtAssetUrlDecoded(artPath: string): boolean {
  const url = getCachedRowArtAssetUrl(artPath);
  return url != null && decodedRowArtAssetUrls.has(url);
}

export function decodeRowArtAssetUrl(url: string): Promise<void> {
  if (decodedRowArtAssetUrls.has(url)) return Promise.resolve();

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    const finish = () => {
      decodedRowArtAssetUrls.add(url);
      resolve();
    };
    img.onload = finish;
    img.onerror = finish;
    img.src = url;
  });
}

/** Ensure thumb file exists and decode it into the browser image cache. */
export async function prefetchRowArtThumb(artPath: string): Promise<void> {
  const thumbPath = await resolveRowArtThumbPath(artPath);
  if (!thumbPath) return;
  await decodeRowArtAssetUrl(rowArtAssetUrl(thumbPath));
}

let idleCallbackId: number | null = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
const pendingQueue: string[] = [];
const queuedArtPaths = new Set<string>();
let processing = false;

const BATCH_SIZE = 3;

function drainQueue(deadline?: IdleDeadline) {
  processing = true;
  let count = 0;

  while (pendingQueue.length > 0 && count < BATCH_SIZE) {
    if (deadline && deadline.timeRemaining() < 6 && count > 0) break;
    const artPath = pendingQueue.shift()!;
    queuedArtPaths.delete(artPath);
    void prefetchRowArtThumb(artPath);
    count += 1;
  }

  processing = false;

  if (pendingQueue.length > 0) {
    scheduleIdleDrain();
  }
}

function scheduleIdleDrain() {
  if (processing || pendingQueue.length === 0) return;
  if (idleCallbackId != null) return;

  if (typeof requestIdleCallback !== "undefined") {
    idleCallbackId = requestIdleCallback(
      (deadline) => {
        idleCallbackId = null;
        drainQueue(deadline);
      },
      { timeout: 150 },
    );
    return;
  }

  timeoutId = setTimeout(() => {
    timeoutId = null;
    drainQueue();
  }, 0);
}

function cancelScheduledDrain() {
  if (idleCallbackId != null && typeof cancelIdleCallback !== "undefined") {
    cancelIdleCallback(idleCallbackId);
    idleCallbackId = null;
  }
  if (timeoutId != null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

/** Queue row art paths for idle prefetch (deduped). */
export function queueRowArtThumbPrefetch(artPaths: Iterable<string>): void {
  for (const artPath of artPaths) {
    if (!artPath || isRowArtAssetUrlDecoded(artPath) || queuedArtPaths.has(artPath)) {
      continue;
    }
    queuedArtPaths.add(artPath);
    pendingQueue.push(artPath);
  }

  scheduleIdleDrain();
}

export function cancelRowArtThumbPrefetch(): void {
  cancelScheduledDrain();
  pendingQueue.length = 0;
  queuedArtPaths.clear();
}
