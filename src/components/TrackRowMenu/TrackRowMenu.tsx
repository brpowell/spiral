import { useTrackMenu } from "../../hooks/useTrackMenu";
import type { Track } from "../../types/track";

interface TrackRowMenuProps {
  track: Track;
  children: React.ReactNode;
  className?: string;
  playlistId?: number;
  interactive?: boolean;
}

export function TrackRowMenu({
  track,
  children,
  className = "",
  playlistId,
  interactive = true,
}: TrackRowMenuProps) {
  const { onContextMenu, contextMenu, removeDialog } = useTrackMenu(track, {
    playlistId,
    disabled: !interactive,
  });

  return (
    <div
      className={`track-row-menu ${className}`.trim()}
      onContextMenu={interactive ? onContextMenu : undefined}
    >
      {children}
      {contextMenu}
      {removeDialog}
    </div>
  );
}
