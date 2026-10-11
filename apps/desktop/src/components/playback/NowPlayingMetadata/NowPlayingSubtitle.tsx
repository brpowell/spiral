import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { albumKey, groupTracksIntoAlbums } from "../../../lib/albums";
import { DEFAULT_ARTIST_JOIN_DELIMITER } from "../../../lib/artistNames";
import { groupTracksIntoArtists } from "../../../lib/artists";
import { isTrackImporting } from "../../../lib/pendingImportTrack";
import {
  artistLinksForTrack,
  isAlbumInLibrary,
} from "../../../lib/trackNavigation";
import { useNavigationStore } from "../../../store/useNavigationStore";
import { usePlayerStore } from "../../../store/usePlayerStore";
import type { Track } from "../../../types/track";
import { ScrollingText } from "../../ScrollingText/ScrollingText";

const SUBTITLE_JOIN = " — ";

export function nowPlayingSubtitleText(
  track: Track | undefined,
): string | null {
  if (!track) return null;
  return [track.artist, track.album].filter(Boolean).join(SUBTITLE_JOIN);
}

interface NowPlayingSubtitleProps {
  track: Track | undefined;
  fallback: string;
  interactive?: boolean;
}

export function NowPlayingSubtitle({
  track,
  fallback,
  interactive = true,
}: NowPlayingSubtitleProps) {
  const text = nowPlayingSubtitleText(track) ?? fallback;

  if (!interactive || !track) {
    return (
      <ScrollingText className="now-playing-metadata__subtitle" text={text} />
    );
  }

  return (
    <ScrollingText className="now-playing-metadata__subtitle" text={text}>
      <NowPlayingSubtitleLinks track={track} fallback={fallback} />
    </ScrollingText>
  );
}

function SubtitleLink({
  label,
  ariaLabel,
  onOpen,
}: {
  label: string;
  ariaLabel: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="now-playing-metadata__link"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {label}
    </button>
  );
}

function NowPlayingSubtitleLinks({
  track,
  fallback,
}: {
  track: Track;
  fallback: string;
}) {
  const { t } = useTranslation("playback");
  const library = usePlayerStore((s) => s.library);
  const openArtist = useNavigationStore((s) => s.openArtist);
  const openAlbum = useNavigationStore((s) => s.openAlbum);

  const liveLibrary = useMemo(
    () => library.filter((item) => !isTrackImporting(item)),
    [library],
  );
  const linkableArtistKeys = useMemo(
    () =>
      new Set(
        groupTracksIntoArtists(liveLibrary, "performers").map(
          (artist) => artist.key,
        ),
      ),
    [liveLibrary],
  );
  const libraryAlbumKeys = useMemo(
    () => new Set(groupTracksIntoAlbums(liveLibrary).map((album) => album.key)),
    [liveLibrary],
  );

  const artistLinks = track.artist?.trim()
    ? artistLinksForTrack(track, linkableArtistKeys)
    : [];
  const albumName = track.album?.trim() ?? "";
  const albumLinkable = isAlbumInLibrary(track, libraryAlbumKeys);

  if (artistLinks.length === 0 && !albumName) {
    return fallback;
  }

  return (
    <>
      {artistLinks.map((link, index) => (
        <Fragment key={`${link.key}-${index}`}>
          {index > 0 ? DEFAULT_ARTIST_JOIN_DELIMITER : null}
          {link.linkable ? (
            <SubtitleLink
              label={link.name}
              ariaLabel={t("nowPlaying.viewArtist", { name: link.name })}
              onOpen={() => openArtist(link.key)}
            />
          ) : (
            link.name
          )}
        </Fragment>
      ))}
      {artistLinks.length > 0 && albumName ? SUBTITLE_JOIN : null}
      {albumName ? (
        albumLinkable ? (
          <SubtitleLink
            label={albumName}
            ariaLabel={t("nowPlaying.viewAlbum", { name: albumName })}
            onOpen={() => openAlbum(albumKey(track))}
          />
        ) : (
          albumName
        )
      ) : null}
    </>
  );
}
