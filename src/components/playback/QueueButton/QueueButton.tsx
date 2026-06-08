import { useMemo } from "react";
import { buildPlaybackOrder } from "../../../lib/activeTrackList";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { Button } from "../../common/Button/Button";
import { IconTrackList } from "../../icons";
import "../playbackControl.css";
import "./QueueButton.css";

interface QueueButtonProps {
  onClick: () => void;
  className?: string;
}

export function QueueButton({ onClick, className }: QueueButtonProps) {
  const library = usePlayerStore((s) => s.library);
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const playContextIds = usePlayerStore((s) => s.playContextIds);
  const manualQueueIds = usePlayerStore((s) => s.manualQueueIds);

  const activeQueue = useMemo(
    () =>
      buildPlaybackOrder(
        manualQueueIds,
        playContextIds,
        library,
        currentTrackId,
      ),
    [manualQueueIds, playContextIds, library, currentTrackId],
  );

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      className={["playback-btn playback-btn--track-list", className]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      disabled={activeQueue.length === 0}
      aria-label="View track list"
      title="View track list"
    >
      <IconTrackList />
    </Button>
  );
}
