import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlbumCard } from "../components/AlbumCard/AlbumCard";
import { BrowseView } from "../components/BrowseView/BrowseView";
import { BrowseViewHeader } from "../components/BrowseView/BrowseViewHeader";
import { BrowseGridBody } from "../components/BrowseView/BrowseGridBody";
import { BrowseVirtualGrid } from "../components/BrowseView/BrowseVirtualGrid";
import { LibraryEmptyState } from "../components/LibraryEmptyState/LibraryEmptyState";
import { SearchField } from "../components/SearchField/SearchField";
import type { Album } from "../types/album";

interface AlbumsViewProps {
  albums: Album[];
}

function matchesAlbumSearch(album: Album, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [album.title, album.artist]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

export function AlbumsView({ albums }: AlbumsViewProps) {
  const { t } = useTranslation("library");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredAlbums = useMemo(
    () => albums.filter((a) => matchesAlbumSearch(a, search)),
    [albums, search],
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
