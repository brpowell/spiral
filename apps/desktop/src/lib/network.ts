/** Best-effort hint for skipping optional network work (metadata, art). */
export function isNetworkLikelyAvailable(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}
