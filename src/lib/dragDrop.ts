export function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes("Files");
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
