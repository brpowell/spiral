import type { CoverArtCandidate } from "../types/coverArt";

const MAX_CACHED_THUMBS = 64;
const thumbCache = new Map<string, HTMLImageElement>();

export function coverArtThumbSrc(candidate: CoverArtCandidate): string {
  return candidate.thumbnailUrl ?? candidate.url;
}

export function isCoverArtThumbReady(src: string): boolean {
  const cached = thumbCache.get(src);
  return Boolean(cached?.complete && cached.naturalWidth > 0);
}

function rememberThumb(src: string, img: HTMLImageElement) {
  if (thumbCache.has(src)) thumbCache.delete(src);
  thumbCache.set(src, img);
  while (thumbCache.size > MAX_CACHED_THUMBS) {
    const oldest = thumbCache.keys().next().value;
    if (oldest == null) break;
    thumbCache.delete(oldest);
  }
}

function preloadSrc(src: string): Promise<void> {
  const cached = thumbCache.get(src);
  if (cached?.complete && cached.naturalWidth > 0) {
    rememberThumb(src, cached);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const img = cached ?? new Image();
    img.onload = finish;
    img.onerror = finish;
    img.src = src;
    rememberThumb(src, img);

    if (img.complete) {
      finish();
      return;
    }

    if (typeof img.decode === "function") {
      void img.decode().then(finish).catch(finish);
    }
  });
}

/** Warm decoded thumbnails so the picker grid can paint without empty tiles. */
export function preloadCoverArtThumbs(
  candidates: CoverArtCandidate[],
): Promise<void> {
  const thumbs = Promise.all(
    candidates.map((candidate) => preloadSrc(coverArtThumbSrc(candidate))),
  ).then(() => undefined);

  return Promise.race([
    thumbs,
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 350);
    }),
  ]);
}
