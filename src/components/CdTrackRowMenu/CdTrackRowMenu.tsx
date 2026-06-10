import { useCdTrackMenu } from "../../hooks/useCdTrackMenu";
import type { Track } from "../../types/track";

interface CdTrackRowMenuProps {
  track: Track;
  driveId: string;
  tracks: Track[];
  children: React.ReactNode;
  className?: string;
}

export function CdTrackRowMenu({
  track,
  driveId,
  tracks,
  children,
  className = "",
}: CdTrackRowMenuProps) {
  const { onContextMenu, contextMenu } = useCdTrackMenu(track, {
    driveId,
    tracks,
  });

  return (
    <div
      className={`track-row-menu ${className}`.trim()}
      onContextMenu={onContextMenu}
    >
      {children}
      {contextMenu}
    </div>
  );
}
