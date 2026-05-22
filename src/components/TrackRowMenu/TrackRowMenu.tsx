import { useTrackEditMenu } from "../../hooks/useTrackEditMenu";
import type { Track } from "../../types/track";

interface TrackRowMenuProps {
  track: Track;
  children: React.ReactNode;
  className?: string;
  playlistId?: number;
}

export function TrackRowMenu({
  track,
  children,
  className = "",
  playlistId,
}: TrackRowMenuProps) {
  const { onContextMenu, contextMenu, removeDialog } = useTrackEditMenu(track, {
    playlistId,
  });

  return (
    <div
      className={`track-row-menu ${className}`.trim()}
      onContextMenu={onContextMenu}
    >
      {children}
      {contextMenu}
      {removeDialog}
    </div>
  );
}
