import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlbumCard } from "../components/AlbumCard/AlbumCard";
import { BrowseView } from "../components/BrowseView/BrowseView";
import { BrowseViewHeader } from "../components/BrowseView/BrowseViewHeader";
import { BrowseGridBody } from "../components/BrowseView/BrowseGridBody";
import { BrowseVirtualGrid } from "../components/BrowseView/BrowseVirtualGrid";
import { LibraryEmptyState } from "../components/LibraryEmptyState/LibraryEmptyState";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { SearchField } from "../components/SearchField/SearchField";
import { createFuzzyMatcher } from "../lib/fuzzySearch";
import type { Album } from "../types/album";

interface AlbumsViewProps {
  albums: Album[];
}

const albumSearch = createFuzzyMatcher<Album>((a) => [
  { fields: [a.title], weight: 1 },
  { fields: [a.artist], weight: 0.75 },
]);

export function AlbumsView({ albums }: AlbumsViewProps) {
  const { t } = useTranslation("library");
  const [search, setSearch] = useState("");
  const deferredSearch = useDebouncedValue(search, 150);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredAlbums = useMemo(
    () => albumSearch.rank(albums, deferredSearch),
    [albums, deferredSearch],
  );

  const getAlbumKey = useCallback((album: Album) => album.key, []);
  const renderAlbum = useCallback(
    (album: Album) => <AlbumCard album={album} />,
    [],
  );

  if (albums.length === 0) {
    return (
      <BrowseView>
        <LibraryEmptyState />
      </BrowseView>
    );
  }

  return (
    <BrowseView>
      <BrowseViewHeader
        title={t("views.albums.title")}
        count={t("views.headerCount", { count: albums.length })}
        actions={
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t("views.albums.searchPlaceholder")}
            aria-label={t("views.albums.searchAria")}
          />
        }
      />

      <BrowseGridBody bodyRef={scrollRef}>
        {filteredAlbums.length === 0 ? (
          <p className="browse-view__empty">{t("views.albums.emptySearch")}</p>
        ) : (
          <BrowseVirtualGrid
            items={filteredAlbums}
            getItemKey={getAlbumKey}
            renderItem={renderAlbum}
            scrollRef={scrollRef}
          />
        )}
      </BrowseGridBody>
    </BrowseView>
  );
}
