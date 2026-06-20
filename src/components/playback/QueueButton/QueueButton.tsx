import { useMemo } from "react";
import { buildPlaybackOrder } from "../../../lib/playbackOrder";
import { usePlayerStore } from "../../../store/usePlayerStore";
import { Button } from "../../common/Button/Button";
import { IconSetList } from "../../icons";
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
      className={["playback-btn playback-btn--set-list", className]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      disabled={activeQueue.length === 0}
      aria-label="View set list"
      title="View set list"
    >
      <IconSetList />
    </Button>
  );
}
