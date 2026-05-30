import { motion } from "framer-motion";
import { EntityArt } from "../EntityArt/EntityArt";
import { useAlbumEditMenu } from "../../hooks/useAlbumEditMenu";
import { useNavigationStore } from "../../store/useNavigationStore";
import type { Album } from "../../types/album";
import "./AlbumCard.css";

interface AlbumCardProps {
  album: Album;
}

export function AlbumCard({ album }: AlbumCardProps) {
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
          <EntityArt artPath={album.artPath} alt={album.title} />
        </div>
        <span className="album-card__title">{album.title}</span>
        <span className="album-card__artist">{album.artist}</span>
      </motion.button>
      {contextMenu}
    </>
  );
}
