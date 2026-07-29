export const ART_DROP_ZONE_SELECTOR = "[data-art-drop-zone]";
export const ART_FILE_DROP_EVENT = "spiral:art-file-drop";

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(path);
}

export function isSpcardPath(path: string): boolean {
  return /\.spcard$/i.test(path);
}

export function firstImagePath(paths: string[]): string | undefined {
  return paths.find(isImagePath);
}

export function firstSpcardPath(paths: string[]): string | undefined {
  return paths.find(isSpcardPath);
}

export function isOverArtDropZone(x: number, y: number): boolean {
  const target = document.elementFromPoint(x, y);
  return !!target?.closest(ART_DROP_ZONE_SELECTOR);
}

export function dispatchArtFileDrop(paths: string[]): void {
  window.dispatchEvent(
    new CustomEvent(ART_FILE_DROP_EVENT, { detail: { paths } }),
  );
}

export type DroppedFileRoute = "art" | "library";

export function routeDroppedPaths(
  paths: string[],
  position?: { x: number; y: number },
): DroppedFileRoute {
  if (position && isOverArtDropZone(position.x, position.y)) {
    dispatchArtFileDrop(paths);
    return "art";
  }
  return "library";
}
