import { useMemo, useState } from "react";
import { AlbumCard } from "../components/AlbumCard/AlbumCard";
import { BrowseView } from "../components/BrowseView/BrowseView";
import { BrowseViewHeader } from "../components/BrowseView/BrowseViewHeader";
import { SearchField } from "../components/SearchField/SearchField";
import type { Album } from "../types/album";
import { BrowseGridBody } from "../components/BrowseView/BrowseGridBody";

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
  const [search, setSearch] = useState("");

  const filteredAlbums = useMemo(
    () => albums.filter((a) => matchesAlbumSearch(a, search)),
    [albums, search],
  );

  if (albums.length === 0) {
    return (
      <BrowseView className="browse-view--empty">
        <p>No albums yet. Import some music to get started.</p>
      </BrowseView>
    );
  }

  return (
    <BrowseView>
      <BrowseViewHeader
        title="Albums"
        count={`(${albums.length})`}
        actions={
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search title or artist…"
            aria-label="Search albums"
          />
        }
      />

      <BrowseGridBody>
        {filteredAlbums.length === 0 ? (
          <p className="browse-view__empty">No albums match your search.</p>
        ) : (
          <div className="browse-grid" role="list">
            {filteredAlbums.map((album) => (
              <AlbumCard key={album.key} album={album} />
            ))}
          </div>
        )}
      </BrowseGridBody>
    </BrowseView>
  );
}
