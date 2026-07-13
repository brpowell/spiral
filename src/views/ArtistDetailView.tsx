import { useMemo } from "react";
import { DiscographyTimeline } from "../components/DiscographyTimeline/DiscographyTimeline";
import { EntityArt } from "../components/EntityArt/EntityArt";
import { Button } from "../components/common/Button/Button";
import { Field, FieldLabel } from "../components/common/Field/Field";
import { Switch } from "../components/common/Switch/Switch";
import { ContextMenuItem } from "../components/ContextMenu/ContextMenu";
import { MenuButton } from "../components/MenuButton/MenuButton";
import {
  IconAddToQueue,
  IconArtistPlaceholder,
  IconBack,
  IconPencil,
  IconPlay,
} from "../components/icons";
import {
  albumsForArtist,
  type ArtistBrowseMode,
  artistTotalDurationSeconds,
  getArtistByKey,
} from "../lib/artists";
import { formatDurationNatural } from "../lib/format";
import { detailReturnLabel } from "../lib/navigationReturn";
import { useNavigationStore } from "../store/useNavigationStore";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import "./ArtistDetailView.css";
import "./DetailViewShared.css";

interface ArtistDetailViewProps {
  albums: Album[];
  artists: Artist[];
  performerArtists: Artist[];
  artistKey: string;
  browseMode: ArtistBrowseMode;
}

export function ArtistDetailView({
  albums,
  artists,
  performerArtists,
  artistKey,
  browseMode,
}: ArtistDetailViewProps) {
  const closeArtist = useNavigationStore((s) => s.closeArtist);
  const artistReturnContext = useNavigationStore((s) => s.artistReturnContext);
  const setArtistBrowseMode = useNavigationStore((s) => s.setArtistBrowseMode);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openArtistEditor = usePlayerStore((s) => s.openArtistEditor);

  const browseArtist = getArtistByKey(artists, artistKey);
  const artist =
    browseArtist ?? getArtistByKey(performerArtists, artistKey);
  const editorBrowseMode = browseArtist != null ? browseMode : "performers";
  const albumArtistsOnly = browseMode === "discography";
  const backLabel = detailReturnLabel(artistReturnContext, artists);
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
          {backLabel}
        </Button>
        <p>Artist not found.</p>
      </div>
    );
  }

  const trackIds = artist.tracks.map((t) => t.id);
  const totalDuration = artistTotalDurationSeconds(artist.tracks);
  const discographySectionTitle = albumArtistsOnly
    ? "Discography"
    : "Appears on";
  const emptyDiscographyMessage = albumArtistsOnly
    ? "No albums in library."
    : "No albums in library for this performer.";

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
          {backLabel}
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
                icon={<IconPencil />}
                label="Edit Artist"
                onClick={() => {
                  close();
                  openArtistEditor(artist.key, editorBrowseMode);
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
              formatDurationNatural(totalDuration),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </section>

      <section className="artist-detail__discography">
        <div className="artist-detail__discography-header">
          <h2 className="artist-detail__section-title">
            {discographySectionTitle}
          </h2>
          <Field orientation="horizontal" className="artist-detail__filter">
            <FieldLabel htmlFor="artist-detail-album-only">
              Album artist only
            </FieldLabel>
            <Switch
              id="artist-detail-album-only"
              checked={albumArtistsOnly}
              onChange={(e) =>
                setArtistBrowseMode(
                  e.target.checked ? "discography" : "performers",
                )
              }
            />
          </Field>
        </div>
        {discography.length > 0 ? (
          <DiscographyTimeline
            albums={discography}
            artist={artist}
            mode={browseMode}
          />
        ) : (
          <p className="artist-detail__empty-discography">
            {emptyDiscographyMessage}
          </p>
        )}
      </section>
    </div>
  );
}
