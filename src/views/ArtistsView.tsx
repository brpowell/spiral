import { motion } from "framer-motion";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrowseView } from "../components/BrowseView/BrowseView";
import { BrowseViewHeader } from "../components/BrowseView/BrowseViewHeader";
import { EntityArt } from "../components/EntityArt/EntityArt";
import { Field, FieldLabel } from "../components/common/Field/Field";
import { Switch } from "../components/common/Switch/Switch";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { SearchField } from "../components/SearchField/SearchField";
import { IconArtistPlaceholder } from "../components/icons";
import { albumsForArtist, type ArtistBrowseMode } from "../lib/artists";
import { createFuzzyMatcher } from "../lib/fuzzySearch";
import { t } from "../lib/i18n";
import { useArtistEditMenu } from "../hooks/useArtistEditMenu";
import { usePointerTiltArt } from "../hooks/usePointerTiltArt";
import { useNavigationStore } from "../store/useNavigationStore";
import type { Album } from "../types/album";
import type { Artist } from "../types/artist";
import { BrowseGridBody } from "../components/BrowseView/BrowseGridBody";
import { BrowseVirtualGrid } from "../components/BrowseView/BrowseVirtualGrid";
import { LibraryEmptyState } from "../components/LibraryEmptyState/LibraryEmptyState";
import "./ArtistsView.css";

interface ArtistsViewProps {
  artists: Artist[];
  albums: Album[];
  browseMode: ArtistBrowseMode;
}

const artistSearch = createFuzzyMatcher<Artist>((a) => [a.name]);

function artistCardMeta(
  artist: Artist,
  albumCount: number,
  browseMode: ArtistBrowseMode,
): string {
  const trackLabel = t("library:counts.tracks", {
    count: artist.tracks.length,
  });
  if (browseMode === "performers") {
    const albumLabel = t("library:counts.albums", { count: albumCount });
    return `${trackLabel} · ${albumLabel}`;
  }
  return t("library:counts.albums", { count: albumCount });
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
            variant="grid"
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
  const { t } = useTranslation("library");
  const [search, setSearch] = useState("");
  const deferredSearch = useDebouncedValue(search, 150);
  const scrollRef = useRef<HTMLDivElement>(null);
  const setArtistBrowseMode = useNavigationStore((s) => s.setArtistBrowseMode);

  const filteredArtists = useMemo(
    () => artistSearch.rank(artists, deferredSearch),
    [artists, deferredSearch],
  );

  const getArtistKey = useCallback((artist: Artist) => artist.key, []);
  const renderArtist = useCallback(
    (artist: Artist) => (
      <ArtistCard
        artist={artist}
        browseMode={browseMode}
        albumCount={albumsForArtist(albums, artist, browseMode).length}
      />
    ),
    [albums, browseMode],
  );

  if (artists.length === 0) {
    return (
      <BrowseView>
        <LibraryEmptyState />
      </BrowseView>
    );
  }

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title={t("views.artists.title")}
        count={t("views.headerCount", { count: artists.length })}
        actions={
          <div className="artists-view__controls">
            <Field orientation="horizontal" className="artists-view__filter">
              <FieldLabel htmlFor="artists-album-only">
                {t("views.artists.albumArtistsOnly")}
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
              placeholder={t("views.artists.searchPlaceholder")}
              aria-label={t("views.artists.searchAria")}
            />
          </div>
        }
      />

      <BrowseGridBody bodyRef={scrollRef}>
        {filteredArtists.length === 0 ? (
          <p className="browse-view__empty">{t("views.artists.emptySearch")}</p>
        ) : (
          <BrowseVirtualGrid
            items={filteredArtists}
            getItemKey={getArtistKey}
            renderItem={renderArtist}
            scrollRef={scrollRef}
          />
        )}
      </BrowseGridBody>
    </BrowseView>
  );
}
