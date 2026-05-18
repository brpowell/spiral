import { motion } from "framer-motion";
import { AlbumArt } from "../components/AlbumArt/AlbumArt";
import { useAlbumEditMenu } from "../hooks/useAlbumEditMenu";
import { useNavigationStore } from "../store/useNavigationStore";
import type { Album } from "../types/album";
import "./AlbumsView.css";

interface AlbumsViewProps {
  albums: Album[];
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
        <h1 className="albums-view__title">Albums</h1>
        <span className="albums-view__count">{albums.length} albums</span>
      </header>

      <div className="albums-grid" role="list">
        {albums.map((album) => (
          <AlbumCard key={album.key} album={album} />
        ))}
      </div>
    </div>
  );
}
