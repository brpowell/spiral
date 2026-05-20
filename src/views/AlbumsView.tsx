import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { AlbumArt } from "../components/AlbumArt/AlbumArt";
import { SearchField } from "../components/SearchField/SearchField";
import { useAlbumEditMenu } from "../hooks/useAlbumEditMenu";
import { useNavigationStore } from "../store/useNavigationStore";
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

function AlbumCard({ album }: { album: Album }) {
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const { onContextMenu, contextMenu } = useAlbumEditMenu(album);

  return (
    <>
      <motion.button
        type="button"
        className="album-card"
        role="listitem"
        onClick={() => openAlbum(album.key)}
        onContextMenu={onContextMenu}
        whileHover={{ scale: 1.03, y: -4 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <div className="album-card__art-wrap">
          <AlbumArt artPath={album.artPath} alt={album.title} />
        </div>
        <span className="album-card__title">{album.title}</span>
        <span className="album-card__artist">{album.artist}</span>
      </motion.button>
      {contextMenu}
    </>
  );
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
