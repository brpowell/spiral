/** Player status label for skin metadata lines. */
export function playbackStatus(
  playbackState: "playing" | "paused" | "stopped",
): string {
  switch (playbackState) {
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
    default:
      return "Stopped";
  }
}

/**
 * Skin metadata line: `{status} - {author} - {title}`.
 */
export function formatMetadataLine(
  status: string,
  artist: string | null | undefined,
  title: string | null | undefined,
): string {
  let authorPart = artist?.trim() ?? "";
  if (authorPart !== "") {
    authorPart += " - ";
  }

  const trackTitle = title?.trim() ?? "";
  if (!trackTitle) return "";

  let line = status;
  if (line !== "") {
    line += " - ";
  }
  line += authorPart;
  line += trackTitle;
  return line;
}
