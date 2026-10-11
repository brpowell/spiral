import { useEffect, useMemo, useState } from "react";
import { toAssetUrl } from "../../lib/assetUrl";
import { findPlaybackTrack } from "../../lib/playbackTrack";
import { useArtistImageStore } from "../../store/useArtistImageStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { MAX_VIZ_TRACK_IMAGE_EDGE } from "./sandbox/resourceBudgets";
import {
  registerVizImage,
  vizTrackBodiesEqual,
  vizTrackCredits,
  type VizFrameTrackBody,
} from "./vizTrack";

const cache = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap | null>>();
const MAX_CACHED_TRACK_IMAGES = 24;

function remember(path: string, bitmap: ImageBitmap): void {
  cache.delete(path);
  cache.set(path, bitmap);
  registerVizImage(path, bitmap);
  while (cache.size > MAX_CACHED_TRACK_IMAGES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    // Drop the cache entry only. A frame may still hold this bitmap.
    cache.delete(oldest);
  }
}

async function decodeTrackImage(url: string): Promise<ImageBitmap | null> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  if (srcW <= 0 || srcH <= 0) return null;
  const scale = Math.min(1, MAX_VIZ_TRACK_IMAGE_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof createImageBitmap !== "function") return null;
  ctx.drawImage(img, 0, 0, width, height);
  return createImageBitmap(canvas);
}

/** Decode a library image path once and reuse the bitmap across viz layers. */
export function loadVizTrackImage(path: string): Promise<ImageBitmap | null> {
  const cached = cache.get(path);
  if (cached) {
    cache.delete(path);
    cache.set(path, cached);
    return Promise.resolve(cached);
  }
  const inflight = pending.get(path);
  if (inflight) return inflight;

  const promise = toAssetUrl(path)
    .then((url) => decodeTrackImage(url))
    .then((bitmap) => {
      pending.delete(path);
      if (!bitmap) return null;
      remember(path, bitmap);
      return bitmap;
    })
    .catch(() => {
      pending.delete(path);
      return null;
    });
  pending.set(path, promise);
  return promise;
}

export function peekVizTrackImage(path: string): ImageBitmap | null {
  return cache.get(path) ?? null;
}

function albumTitle(album: string | null | undefined): string | null {
  const trimmed = album?.trim();
  return trimmed ? trimmed : null;
}

/** Title, album, artists, and decoded cover/portraits for the current track. */
export function useVisualizerTrack(): VizFrameTrack {
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const library = usePlayerStore((s) => s.library);
  const playbackTracks = usePlayerStore((s) => s.playbackTracks);
  const imagesByKey = useArtistImageStore((s) => s.imagesByKey);
  const loadArtistImages = useArtistImageStore((s) => s.loadArtistImages);

  useEffect(() => {
    void loadArtistImages();
  }, [loadArtistImages]);

  const track = useMemo(
    () =>
      findPlaybackTrack({ library, playbackTracks, currentTrackId }) ?? null,
    [library, playbackTracks, currentTrackId],
  );

  const [vizTrack, setVizTrack] = useState<VizFrameTrackBody>({
    id: null,
    title: "",
    album: null,
    artists: [],
    art: null,
  });

  useEffect(() => {
    let cancelled = false;
    const credits = vizTrackCredits(track?.artist, track?.albumArtist);
    const artPath = track?.artPath ?? null;
    const portraitPaths = credits.map(
      (credit) => imagesByKey[credit.key] ?? null,
    );
    const id = track?.id ?? null;
    const title = track?.title ?? "";
    const album = albumTitle(track?.album);

    const immediate: VizFrameTrackBody = {
      id,
      title,
      album,
      art: artPath ? peekVizTrackImage(artPath) : null,
      artists: credits.map((credit, index) => {
        const path = portraitPaths[index];
        return {
          name: credit.name,
          portrait: path ? peekVizTrackImage(path) : null,
        };
      }),
    };
    setVizTrack((prev) =>
      vizTrackBodiesEqual(prev, immediate) ? prev : immediate,
    );

    const artMissing = Boolean(artPath) && !immediate.art;
    const portraitMissing = portraitPaths.some(
      (path, index) => path && !immediate.artists[index]?.portrait,
    );
    if (!artMissing && !portraitMissing) return;

    void (async () => {
      const [art, portraits] = await Promise.all([
        artPath ? loadVizTrackImage(artPath) : Promise.resolve(null),
        Promise.all(
          portraitPaths.map((path) =>
            path ? loadVizTrackImage(path) : Promise.resolve(null),
          ),
        ),
      ]);
      if (cancelled) return;
      const next: VizFrameTrackBody = {
        id,
        title,
        album,
        art,
        artists: credits.map((credit, index) => ({
          name: credit.name,
          portrait: portraits[index] ?? null,
        })),
      };
      setVizTrack((prev) => (vizTrackBodiesEqual(prev, next) ? prev : next));
    })();

    return () => {
      cancelled = true;
    };
  }, [track, imagesByKey]);

  return vizTrack;
}
