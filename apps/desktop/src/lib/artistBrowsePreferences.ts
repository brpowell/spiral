import type { ArtistBrowseMode } from "./artists";

const STORAGE_KEY = "spiral:artistBrowseMode";

export function loadArtistBrowseMode(): ArtistBrowseMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "discography" || raw === "performers") return raw;
  } catch {
    /* ignore quota / private mode */
  }
  return "discography";
}

export function saveArtistBrowseMode(mode: ArtistBrowseMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
