export const SUPPORTED_AUDIO_EXTENSIONS = [
  "mp3",
  "flac",
  "aac",
  "wav",
  "m4a",
] as const;

const BLOCKED_AUDIO_EXTENSIONS = new Set(["m4p"]);

export function audioExtensionFromPath(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isSupportedAudioPath(path: string): boolean {
  const ext = audioExtensionFromPath(path);
  if (!ext || BLOCKED_AUDIO_EXTENSIONS.has(ext)) return false;
  return (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/** Keep folders and supported audio files; drop unsupported files (e.g. .m4p). */
export function filterPathsForLibraryImport(paths: string[]): string[] {
  return paths.filter((path) => {
    const ext = audioExtensionFromPath(path);
    if (!ext) return true;
    return isSupportedAudioPath(path);
  });
}
