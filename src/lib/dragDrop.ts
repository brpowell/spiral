/** In-app track reorder drags (not OS file drops). */
export const TRACK_REORDER_DRAG_TYPE = "application/x-spiral-track-reorder";

export function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types);
  if (types.includes(TRACK_REORDER_DRAG_TYPE)) return false;
  return types.includes("Files");
}

export function pathsFromDataTransfer(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];
  const paths: string[] = [];
  for (const file of Array.from(dataTransfer.files)) {
    const path = (file as File & { path?: string }).path;
    if (path) paths.push(path);
  }
  return paths;
}
