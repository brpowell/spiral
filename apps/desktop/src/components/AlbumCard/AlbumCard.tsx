import { motion } from "framer-motion";
import { EntityArt } from "../EntityArt/EntityArt";
import { useAlbumEditMenu } from "../../hooks/useAlbumEditMenu";
import { usePointerTiltArt } from "../../hooks/usePointerTiltArt";
import { useNavigationStore } from "../../store/useNavigationStore";
import type { Album } from "../../types/album";
import "./AlbumCard.css";

interface AlbumCardProps {
  album: Album;
}

export function AlbumCard({ album }: AlbumCardProps) {
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const { onContextMenu, contextMenu } = useAlbumEditMenu(album);
  const { className: tiltClassName, ...artMotion } = usePointerTiltArt();

  return (
    <>
      <button
        type="button"
        className="album-card"
        role="listitem"
        onClick={() => openAlbum(album.key)}
        onContextMenu={onContextMenu}
      >
        <motion.div
          className={`album-card__art-wrap ${tiltClassName}`}
          {...artMotion}
        >
          <EntityArt artPath={album.artPath} alt={album.title} variant="grid" />
        </motion.div>
        <span className="album-card__title">{album.title}</span>
        <span className="album-card__artist">{album.artist}</span>
      </button>
      {contextMenu}
    </>
  );
}
