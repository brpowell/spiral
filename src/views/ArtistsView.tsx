import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { EntityArt } from "../components/EntityArt/EntityArt";
import { Select } from "../components/common/Select/Select";
import { SearchField } from "../components/SearchField/SearchField";
import { IconArtistPlaceholder } from "../components/icons";
import {
  albumsForArtist,
  ARTIST_BROWSE_MODES,
  type ArtistBrowseMode,
} from "../lib/artists";
import { useArtistEditMenu } from "../hooks/useArtistEditMenu";
import { useNavigationStore } from "../store/useNavigationStore";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import "./ArtistsView.css";

interface ArtistsViewProps {
  artists: Artist[];
  albums: Album[];
  browseMode: ArtistBrowseMode;
}

const BROWSE_MODE_OPTIONS = ARTIST_BROWSE_MODES.map((m) => ({
  value: m.value,
  label: m.label,
  description: m.description,
}));

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

  return (
    <>
      <motion.button
        type="button"
        className="artist-card"
        role="listitem"
        onClick={() => openArtist(artist.key)}
        onContextMenu={onContextMenu}
        whileHover={{ scale: 1.03, y: -4 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <div className="artist-card__art-wrap">
          <EntityArt
            artPath={artist.artPath}
            alt={artist.name}
            className="album-art--round"
            placeholder={<IconArtistPlaceholder />}
          />
        </div>
        <span className="artist-card__name">{artist.name}</span>
        <span className="artist-card__meta">
          {artistCardMeta(artist, albumCount, browseMode)}
        </span>
      </motion.button>
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
      <div className="artists-view artists-view--empty">
        <p>No artists yet. Import some music to get started.</p>
      </div>
    );
  }

  return (
    <div className="artists-view">
      <header className="artists-view__header">
        <div className="artists-view__heading">
          <h1 className="artists-view__title">Artists</h1>
          <span className="artists-view__count">({artists.length})</span>
        </div>
        <div className="artists-view__controls">
          <Select
            className="artists-view__browse"
            aria-label="Artist browse mode"
            value={browseMode}
            onChange={setArtistBrowseMode}
            options={BROWSE_MODE_OPTIONS}
          />
          <SearchField
            className="artists-view__search"
            value={search}
            onChange={setSearch}
            placeholder="Search artists…"
            aria-label="Search artists"
          />
        </div>
      </header>

      {filteredArtists.length === 0 ? (
        <p className="artists-view__empty">No artists match your search.</p>
      ) : (
        <div className="artists-grid" role="list">
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
    </div>
  );
}
