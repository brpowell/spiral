import { useMemo } from "react";
import { DiscographyTimeline } from "../components/DiscographyTimeline/DiscographyTimeline";
import { EntityArt } from "../components/EntityArt/EntityArt";
import { Button } from "../components/common/Button/Button";
import { ContextMenuItem } from "../components/ContextMenu/ContextMenu";
import { MenuButton } from "../components/MenuButton/MenuButton";
import {
  IconAddToQueue,
  IconArtistPlaceholder,
  IconBack,
  IconEditInfo,
  IconPlay,
} from "../components/icons";
import {
  albumsForArtist,
  type ArtistBrowseMode,
  artistTotalDurationSeconds,
  getArtistByKey,
} from "../lib/artists";
import { formatTime } from "../lib/format";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import "./ArtistDetailView.css";

interface ArtistDetailViewProps {
  albums: Album[];
  artists: Artist[];
  artistKey: string;
  browseMode: ArtistBrowseMode;
}

export function ArtistDetailView({
  albums,
  artists,
  artistKey,
  browseMode,
}: ArtistDetailViewProps) {
  const closeArtist = useNavigationStore((s) => s.closeArtist);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openArtistEditor = usePlayerStore((s) => s.openArtistEditor);

  const artist = getArtistByKey(artists, artistKey);
  const discography = useMemo(
    () => (artist ? albumsForArtist(albums, artist, browseMode) : []),
    [albums, artist, browseMode],
  );

  if (!artist) {
    return (
      <div className="artist-detail artist-detail--missing">
        <Button
          variant="ghost"
          size="sm"
          className="artist-detail__back"
          onClick={closeArtist}
        >
          <IconBack />
          Artists
        </Button>
        <p>Artist not found.</p>
      </div>
    );
  }

  const trackIds = artist.tracks.map((t) => t.id);
  const totalDuration = artistTotalDurationSeconds(artist.tracks);
  const discographySectionTitle =
    browseMode === "performers" ? "Appears on" : "Discography";
  const emptyDiscographyMessage =
    browseMode === "performers"
      ? "No albums in library for this performer."
      : "No albums in library.";

  const handlePlayAll = () => {
    const first = artist.tracks[0];
    if (first) void playTracks(trackIds, first.id);
  };

  const handleAddToQueue = () => {
    addToQueue(trackIds);
  };

  return (
    <div className="artist-detail">
      <div className="artist-detail__toolbar">
        <Button
          variant="ghost"
          size="sm"
          className="artist-detail__back"
          onClick={closeArtist}
        >
          <IconBack />
          Artists
        </Button>
        <MenuButton
          ariaLabel="Artist actions"
          className="artist-detail__toolbar-menu"
          layoutDeps={[artist.tracks.length]}
          size="md"
          variant="secondary"
        >
          {(close) => (
            <>
              <ContextMenuItem
                icon={<IconEditInfo />}
                label="Edit Artist"
                onClick={() => {
                  close();
                  openArtistEditor(artist.key, browseMode);
                }}
              />
              {artist.tracks.length > 0 ? (
                <ContextMenuItem
                  icon={<IconAddToQueue />}
                  label="Add to Queue"
                  onClick={() => {
                    close();
                    handleAddToQueue();
                  }}
                />
              ) : null}
              <ContextMenuItem
                icon={<IconPlay />}
                label="Play All"
                disabled={artist.tracks.length === 0}
                onClick={() => {
                  close();
                  handlePlayAll();
                }}
              />
            </>
          )}
        </MenuButton>
      </div>

      <section className="artist-detail__hero">
        <EntityArt
          artPath={artist.artPath}
          alt={artist.name}
          className="album-art--hero album-art--round artist-detail__art"
          placeholder={<IconArtistPlaceholder />}
        />
        <div className="artist-detail__meta">
          <h1 className="artist-detail__title">{artist.name}</h1>
          <p className="artist-detail__stats">
            {[
              `${discography.length} ${discography.length === 1 ? "album" : "albums"}`,
              `${artist.tracks.length} ${artist.tracks.length === 1 ? "track" : "tracks"}`,
              formatTime(totalDuration),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </section>

      {discography.length > 0 ? (
        <section className="artist-detail__discography">
          <h2 className="artist-detail__section-title">
            {discographySectionTitle}
          </h2>
          <DiscographyTimeline albums={discography} />
        </section>
      ) : (
        <p className="artist-detail__empty-discography">
          {emptyDiscographyMessage}
        </p>
      )}
    </div>
  );
}
