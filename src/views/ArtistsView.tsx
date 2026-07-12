import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { BrowseView } from "../components/BrowseView/BrowseView";
import { BrowseViewHeader } from "../components/BrowseView/BrowseViewHeader";
import { EntityArt } from "../components/EntityArt/EntityArt";
import { Field, FieldLabel } from "../components/common/Field/Field";
import { Switch } from "../components/common/Switch/Switch";
import { SearchField } from "../components/SearchField/SearchField";
import { IconArtistPlaceholder } from "../components/icons";
import { albumsForArtist, type ArtistBrowseMode } from "../lib/artists";
import { useArtistEditMenu } from "../hooks/useArtistEditMenu";
import { usePointerTiltArt } from "../hooks/usePointerTiltArt";
import { useNavigationStore } from "../store/useNavigationStore";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import { BrowseGridBody } from "../components/BrowseView/BrowseGridBody";
import "./ArtistsView.css";

interface ArtistsViewProps {
  artists: Artist[];
  albums: Album[];
  browseMode: ArtistBrowseMode;
}

function matchesArtistSearch(artist: Artist, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return artist.name.toLowerCase().includes(q);
}

function artistCardMeta(
  artist: Artist,
  albumCount: number,
  browseMode: ArtistBrowseMode,
): string {
  const trackLabel =
    artist.tracks.length === 1
      ? "1 track"
      : `${artist.tracks.length} tracks`;
  if (browseMode === "performers") {
    const albumLabel =
      albumCount === 1 ? "1 album" : `${albumCount} albums`;
    return `${trackLabel} · ${albumLabel}`;
  }
  return albumCount === 1 ? "1 album" : `${albumCount} albums`;
}

function ArtistCard({
  artist,
  albumCount,
  browseMode,
}: {
  artist: Artist;
  albumCount: number;
  browseMode: ArtistBrowseMode;
}) {
  const openArtist = useNavigationStore((s) => s.openArtist);
  const { onContextMenu, contextMenu } = useArtistEditMenu(artist, browseMode);
  const { className: tiltClassName, ...artMotion } = usePointerTiltArt();

  return (
    <>
      <button
        type="button"
        className="artist-card"
        role="listitem"
        onClick={() => openArtist(artist.key)}
        onContextMenu={onContextMenu}
      >
        <motion.div
          className={`artist-card__art-wrap ${tiltClassName}`}
          {...artMotion}
        >
          <EntityArt
            artPath={artist.artPath}
            alt={artist.name}
            className="album-art--round"
            placeholder={<IconArtistPlaceholder />}
          />
        </motion.div>
        <span className="artist-card__name">{artist.name}</span>
        <span className="artist-card__meta">
          {artistCardMeta(artist, albumCount, browseMode)}
        </span>
      </button>
      {contextMenu}
    </>
  );
}

export function ArtistsView({ artists, albums, browseMode }: ArtistsViewProps) {
  const [search, setSearch] = useState("");
  const setArtistBrowseMode = useNavigationStore((s) => s.setArtistBrowseMode);

  const filteredArtists = useMemo(
    () => artists.filter((a) => matchesArtistSearch(a, search)),
    [artists, search],
  );

  if (artists.length === 0) {
    return (
      <BrowseView className="browse-view--empty">
        <p>No artists yet. Import some music to get started.</p>
      </BrowseView>
    );
  }

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title="Artists"
        count={`(${artists.length})`}
        actions={
          <div className="artists-view__controls">
            <Field orientation="horizontal" className="artists-view__filter">
              <FieldLabel htmlFor="artists-album-only">
                Album artists only
              </FieldLabel>
              <Switch
                id="artists-album-only"
                checked={browseMode === "discography"}
                onChange={(e) =>
                  setArtistBrowseMode(
                    e.target.checked ? "discography" : "performers",
                  )
                }
              />

            </Field>
            <SearchField
              className="artists-view__search"
              value={search}
              onChange={setSearch}
              placeholder="Search artists…"
              aria-label="Search artists"
            />
          </div>
        }
      />

      <BrowseGridBody>
        {filteredArtists.length === 0 ? (
          <p className="browse-view__empty">No artists match your search.</p>
        ) : (
          <div className="browse-grid" role="list">
            {filteredArtists.map((artist) => (
              <ArtistCard
                key={artist.key}
                artist={artist}
                browseMode={browseMode}
                albumCount={albumsForArtist(albums, artist, browseMode).length}
              />
            ))}
          </div>
        )}
      </BrowseGridBody>
    </BrowseView>
  );
}
