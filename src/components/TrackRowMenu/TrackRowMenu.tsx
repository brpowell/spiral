import { useTrackEditMenu } from "../../hooks/useTrackEditMenu";
import type { Track } from "../../types/track";

interface TrackRowMenuProps {
  track: Track;
  children: React.ReactNode;
  className?: string;
}

export function TrackRowMenu({ track, children, className = "" }: TrackRowMenuProps) {
  const { onContextMenu, contextMenu, removeDialog } = useTrackEditMenu(track);

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
