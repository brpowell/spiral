import { motion } from "framer-motion";
import { useMemo } from "react";
import { groupAlbumsForTimeline } from "../../lib/discographyTimeline";
import { useAlbumEditMenu } from "../../hooks/useAlbumEditMenu";
import { useNavigationStore } from "../../store/useNavigationStore";
import { EntityArt } from "../EntityArt/EntityArt";
import type { Album } from "../../types/album";
import "./DiscographyTimeline.css";

interface DiscographyTimelineProps {
  albums: Album[];
}

function TimelineAlbumEntry({ album }: { album: Album }) {
  const openAlbum = useNavigationStore((s) => s.openAlbum);
  const { onContextMenu, contextMenu } = useAlbumEditMenu(album);
  const trackLabel =
    album.tracks.length === 1 ? "1 track" : `${album.tracks.length} tracks`;

  return (
    <>
      <motion.button
        type="button"
        className="discography-timeline__entry"
        onClick={() => openAlbum(album.key)}
        onContextMenu={onContextMenu}
        whileHover={{ x: 4 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
      >
        <div className="discography-timeline__entry-art">
          <EntityArt artPath={album.artPath} alt={album.title} />
        </div>
        <div className="discography-timeline__entry-meta">
          <span className="discography-timeline__entry-title">{album.title}</span>
          <span className="discography-timeline__entry-sub">{trackLabel}</span>
        </div>
      </motion.button>
      {contextMenu}
    </>
  );
}

export function DiscographyTimeline({ albums }: DiscographyTimelineProps) {
  const groups = useMemo(() => groupAlbumsForTimeline(albums), [albums]);

  return (
    <ol className="discography-timeline" aria-label="Discography timeline">
      {groups.map((group, groupIndex) => (
        <li
          key={group.year ?? "unknown"}
          className="discography-timeline__year-group"
        >
          <div className="discography-timeline__year-marker" aria-hidden>
            <span className="discography-timeline__year">{group.label}</span>
            <span className="discography-timeline__node" />
          </div>
          <ul className="discography-timeline__entries" role="list">
            {group.albums.map((album, albumIndex) => {
              const isLastGroup = groupIndex === groups.length - 1;
              const isLastAlbum = albumIndex === group.albums.length - 1;
              return (
                <li
                  key={album.key}
                  className={
                    isLastGroup && isLastAlbum
                      ? "discography-timeline__entry-wrap discography-timeline__entry-wrap--last"
                      : "discography-timeline__entry-wrap"
                  }
                >
                  <TimelineAlbumEntry album={album} />
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
