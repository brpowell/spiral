interface BitmapCacheEntry {
  promise: Promise<HTMLImageElement>;
  image?: HTMLImageElement;
}

const cache = new Map<string, BitmapCacheEntry>();

/** True when a bitmap URL has already been decoded by {@link loadSkinBitmap}. */
export function isSkinBitmapReady(url: string): boolean {
  return cache.get(url)?.image !== undefined;
}

/** Decode a skin bitmap once and reuse the result for `<img>` and preload. */
export function loadSkinBitmap(url: string): Promise<HTMLImageElement> {
  let entry = cache.get(url);
  if (!entry) {
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        entry!.image = img;
        resolve(img);
      };
      img.onerror = () =>
        reject(new Error(`Failed to decode skin bitmap: ${url}`));
      img.src = url;
    });
    entry = { promise };
    cache.set(url, entry);
  }
  return entry.promise;
}
