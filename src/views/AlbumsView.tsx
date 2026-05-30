import { useMemo, useState } from "react";
import { AlbumCard } from "../components/AlbumCard/AlbumCard";
import { SearchField } from "../components/SearchField/SearchField";
import type { Album } from "../types/album";
import "./AlbumsView.css";

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
      <div className="albums-view albums-view--empty">
        <p>No albums yet. Import some music to get started.</p>
      </div>
    );
  }

  return (
    <div className="albums-view">
      <header className="albums-view__header">
        <div className="albums-view__heading">
          <h1 className="albums-view__title">Albums</h1>
          <span className="albums-view__count">({albums.length})</span>
        </div>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search title or artist…"
          aria-label="Search albums"
        />
      </header>

      {filteredAlbums.length === 0 ? (
        <p className="albums-view__empty">No albums match your search.</p>
      ) : (
        <div className="albums-grid" role="list">
          {filteredAlbums.map((album) => (
            <AlbumCard key={album.key} album={album} />
          ))}
        </div>
      )}
    </div>
  );
}
