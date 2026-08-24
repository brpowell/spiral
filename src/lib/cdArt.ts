import {
  fetchAlbumArtPreferringRelease,
  resolveAlbumArtPath,
} from "./albumArtFetch";
import { resolveArtPathIfExists } from "./artPath";
import { cdHeroArtPath } from "./cdPlaybackArt";
import { useCdStore } from "../store/useCdStore";

export async function ensureCdHeroArtValid(
  driveId: string,
): Promise<string | null> {
  const heroPath = cdHeroArtPath(driveId);
  if (!heroPath) return null;
  const valid = await resolveArtPathIfExists(heroPath);
  if (valid) return valid;
  useCdStore.getState().setHeroArt(driveId, null);
  return null;
}

export async function resolveCdSharedArtPath(options: {
  driveId: string;
  existingAlbumArtPath?: string | null;
  albumArtist?: string | null;
  albumTitle?: string | null;
  releaseMbid?: string | null;
  onFetching?: () => void;
}): Promise<string | null> {
  const {
    driveId,
    existingAlbumArtPath,
    albumArtist,
    albumTitle,
    releaseMbid,
    onFetching,
  } = options;

  const validHero = await resolveArtPathIfExists(cdHeroArtPath(driveId));
  if (validHero) return validHero;
  if (cdHeroArtPath(driveId)) {
    useCdStore.getState().setHeroArt(driveId, null);
  }

  const validAlbumArt = await resolveArtPathIfExists(existingAlbumArtPath);
  if (validAlbumArt) return validAlbumArt;

  if (!albumArtist || !albumTitle) return null;

  const cacheLabel = `${albumArtist} - ${albumTitle}`;
  const disc = useCdStore.getState().discsByDriveId[driveId];
  let artPath = await resolveAlbumArtPath(cacheLabel);
  if (!artPath) {
    onFetching?.();
    artPath = await fetchAlbumArtPreferringRelease({
      artist: albumArtist,
      album: albumTitle,
      releaseMbid,
      cacheLabel,
      logContext: {
        driveId,
        discId: disc?.discId,
        artist: albumArtist,
        album: albumTitle,
        releaseMbid: releaseMbid ?? undefined,
      },
    });
  }
  if (artPath) {
    useCdStore.getState().setHeroArt(driveId, artPath);
  }
  return artPath;
}
