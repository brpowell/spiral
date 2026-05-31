export function revealInFileManagerLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "Reveal in Finder";
  if (ua.includes("Win")) return "Show in File Explorer";
  return "Show in File Manager";
}
