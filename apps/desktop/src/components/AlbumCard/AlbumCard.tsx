import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { EntityArt } from "@/components/EntityArt/EntityArt";
import { useAlbumEditMenu } from "@/hooks/useAlbumEditMenu";
import { usePointerTiltArt } from "@/hooks/usePointerTiltArt";
import { useNavigationStore } from "@/store/useNavigationStore";
import type { Album } from "@/types/album";
import "./AlbumCard.css";

interface AlbumCardProps {
  album: Album;
  /** Artist page key; the artist name is only a link when this is set. */
  artistKey?: string | null;
}

export function AlbumCard({ album, artistKey }: AlbumCardProps) {
  const { t } = useTranslation("library");
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const openArtist = useNavigationStore((s) => s.openArtist);
  const { onContextMenu, contextMenu } = useAlbumEditMenu(album);
  const { className: tiltClassName, ...artMotion } = usePointerTiltArt();

  return (
    <>
      <div className="album-card" role="listitem" onContextMenu={onContextMenu}>
        <button
          type="button"
          className="album-card__open"
          onClick={() => openAlbum(album.key)}
        >
          <motion.div
            className={`album-card__art-wrap ${tiltClassName}`}
            {...artMotion}
          >
            <EntityArt
              artPath={album.artPath}
              alt={album.title}
              variant="grid"
            />
          </motion.div>
          <span className="album-card__title">{album.title}</span>
        </button>
        {artistKey ? (
          <button
            type="button"
            className="album-card__artist album-card__artist--link"
            aria-label={t("views.albums.viewArtist", { name: album.artist })}
            onClick={() => openArtist(artistKey)}
          >
            {album.artist}
          </button>
        ) : (
          <span className="album-card__artist">{album.artist}</span>
        )}
      </div>
      {contextMenu}
    </>
  );
}
